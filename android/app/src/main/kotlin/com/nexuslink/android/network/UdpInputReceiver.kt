package com.nexuslink.android.network

import android.util.Log
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

data class UdpInputEvent(
    val eventType: Int,
    val sequence: Long,
    val dxOrCode: Int,
    val dyOrMods: Int,
    val buttonState: Int,
    val flags: Int
)

/**
 * Récepteur UDP basse latence (port 52841) décodant les trames binaires de 16 octets Big-Endian
 * authentifiées par HMAC-SHA256 tronqué sur 32 bits.
 */
class UdpInputReceiver(
    private val port: Int = DEFAULT_UDP_PORT,
    private val sessionSecretProvider: () -> String?,
    private val onEventReceived: (UdpInputEvent) -> Unit
) {
    private val running = AtomicBoolean(false)
    private var socket: DatagramSocket? = null
    private var receiverThread: Thread? = null
    private var lastMoveSequence: Long = 0L
    private var lastActionSequence: Long = 0L
    private var loggedFirstPacket = false

    fun start() {
        if (!running.compareAndSet(false, true)) return

        receiverThread = Thread({
            try {
                val sock = DatagramSocket(port)
                socket = sock
                Log.d(TAG, "Récepteur UDP démarré sur le port $port")
                val buffer = ByteArray(64)
                val packet = DatagramPacket(buffer, buffer.size)

                while (running.get()) {
                    sock.receive(packet)
                    if (packet.length < FRAME_SIZE) continue

                    val frame = packet.data
                    if (frame[0] != MAGIC_BYTE) continue

                    val secret = sessionSecretProvider()?.takeIf { it.isNotEmpty() }
                    if (secret == null) {
                        Log.w(TAG, "Paquet UDP ignoré : sessionSecret manquant")
                        continue
                    }
                    if (!verifyAuthTag(frame, secret)) {
                        Log.w(TAG, "Paquet UDP ignoré : tag HMAC invalide")
                        continue
                    }

                    if (!loggedFirstPacket) {
                        loggedFirstPacket = true
                        Log.d(TAG, "Premier paquet UDP authentifié reçu depuis ${packet.address.hostAddress}")
                    }

                    val bb = ByteBuffer.wrap(frame, 0, FRAME_SIZE).order(ByteOrder.BIG_ENDIAN)
                    bb.get() // magic
                    val eventType = bb.get().toInt() and 0xFF
                    val sequence = bb.int.toLong() and 0xFFFFFFFFL
                    val dxOrCode = bb.short.toInt()
                    val dyOrMods = bb.short.toInt()
                    val buttonState = bb.get().toInt() and 0xFF
                    val flags = bb.get().toInt() and 0xFF

                    // Protection anti-rejeu séparée (un MOVE ne peut jamais rejeter un clic/relâchement)
                    if (eventType == EVENT_MOUSE_MOVE) {
                        if (sequence != 1L && sequence <= lastMoveSequence && (lastMoveSequence - sequence) < 10_000L) {
                            Log.w(TAG, "Paquet MOVE rejeté (rejeu) seq=$sequence dernier=$lastMoveSequence")
                            continue
                        }
                        lastMoveSequence = sequence
                    } else {
                        if (sequence != 1L && sequence <= lastActionSequence && (lastActionSequence - sequence) < 10_000L) {
                            Log.w(
                                TAG,
                                "Paquet ACTION rejeté (rejeu) type=$eventType seq=$sequence " +
                                    "dernier=$lastActionSequence buttons=$buttonState"
                            )
                            continue
                        }
                        lastActionSequence = sequence
                    }

                    onEventReceived(
                        UdpInputEvent(
                            eventType = eventType,
                            sequence = sequence,
                            dxOrCode = dxOrCode,
                            dyOrMods = dyOrMods,
                            buttonState = buttonState,
                            flags = flags
                        )
                    )
                }
            } catch (e: Exception) {
                if (running.get()) {
                    Log.w(TAG, "Erreur dans UdpInputReceiver : ${e.message}", e)
                }
            } finally {
                socket?.close()
                socket = null
            }
        }, "NexusUdpInputReceiver").apply {
            priority = Thread.MAX_PRIORITY
            isDaemon = true
            start()
        }
    }

    fun stop() {
        running.set(false)
        socket?.close()
        socket = null
        receiverThread = null
        lastMoveSequence = 0L
        lastActionSequence = 0L
    }

    private fun verifyAuthTag(frame: ByteArray, secret: String): Boolean {
        return try {
            val mac = Mac.getInstance("HmacSHA256")
            mac.init(SecretKeySpec(secret.toByteArray(Charsets.UTF_8), "HmacSHA256"))
            mac.update(frame, 0, 12)
            val digest = mac.doFinal()
            digest[0] == frame[12] &&
                digest[1] == frame[13] &&
                digest[2] == frame[14] &&
                digest[3] == frame[15]
        } catch (_: Exception) {
            false
        }
    }

    companion object {
        private const val TAG = "NexusUdpInput"
        const val DEFAULT_UDP_PORT = 52841
        private const val FRAME_SIZE = 16
        private const val MAGIC_BYTE: Byte = 0x4E

        const val EVENT_MOUSE_MOVE = 0x01
        const val EVENT_MOUSE_BUTTON = 0x02
        const val EVENT_MOUSE_WHEEL = 0x03
        const val EVENT_KEY_EVENT = 0x04
    }
}
