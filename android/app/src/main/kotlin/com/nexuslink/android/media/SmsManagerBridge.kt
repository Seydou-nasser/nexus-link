package com.nexuslink.android.media

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.ContactsContract
import android.provider.Telephony
import android.telephony.SmsManager
import android.util.Log
import androidx.core.content.ContextCompat
import kotlinx.serialization.Serializable
import java.util.concurrent.ConcurrentHashMap

@Serializable
data class SmsConversationDto(
    val threadId: Long,
    val address: String,
    val contactName: String,
    val snippet: String,
    val dateMs: Long,
    val unreadCount: Int
)

@Serializable
data class SmsMessageDto(
    val id: Long,
    val threadId: Long,
    val address: String,
    val body: String,
    val dateMs: Long,
    val isOutgoing: Boolean
)

@Serializable
data class SmsContactDto(
    val name: String,
    val phoneNumber: String
)

@Serializable
data class SmsSendRequest(
    val address: String,
    val body: String
)

sealed class SmsOpResult<out T> {
    data class Success<T>(val value: T) : SmsOpResult<T>()
    data class Error(val httpStatus: Int, val message: String) : SmsOpResult<Nothing>()
}

/**
 * Pont léger vers Telephony.Sms et ContactsContract pour lire les conversations,
 * rechercher les contacts et envoyer des SMS depuis le PC connecté.
 */
class SmsManagerBridge(private val context: Context) {

    private class ConversationAccumulator(
        val threadId: Long,
        val address: String,
        val snippet: String,
        val dateMs: Long,
        var unreadCount: Int = 0
    )

    // Cache mémoire des noms de contacts résolus (numéro -> nom affiché)
    private val contactNameCache = ConcurrentHashMap<String, String>()

    fun hasReadSmsPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
            PackageManager.PERMISSION_GRANTED

    fun hasSendSmsPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.SEND_SMS) ==
            PackageManager.PERMISSION_GRANTED

    fun hasContactsPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED

    fun listConversations(limit: Int = DEFAULT_CONVERSATIONS_LIMIT): SmsOpResult<List<SmsConversationDto>> {
        if (!hasReadSmsPermission()) {
            return SmsOpResult.Error(
                403,
                "Activez la permission « Messages SMS » dans l'application Android NexusLink."
            )
        }

        val safeLimit = limit.coerceIn(1, 120)
        val projection = arrayOf(
            Telephony.Sms.THREAD_ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.READ
        )

        val conversations = LinkedHashMap<Long, ConversationAccumulator>()

        try {
            context.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                projection,
                null,
                null,
                "${Telephony.Sms.DATE} DESC"
            )?.use { cursor ->
                val threadIdx = cursor.getColumnIndex(Telephony.Sms.THREAD_ID)
                val addrIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY)
                val dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE)
                val readIdx = cursor.getColumnIndex(Telephony.Sms.READ)

                var scannedRows = 0
                while (cursor.moveToNext() && scannedRows < MAX_SCAN_ROWS) {
                    scannedRows++
                    val threadId = if (threadIdx >= 0) cursor.getLong(threadIdx) else 0L
                    if (threadId <= 0L) continue

                    val existing = conversations[threadId]
                    val isUnread = readIdx >= 0 && cursor.getInt(readIdx) == 0

                    if (existing == null) {
                        if (conversations.size >= safeLimit) continue
                        val address = if (addrIdx >= 0) cursor.getString(addrIdx)?.trim().orEmpty() else ""
                        val body = if (bodyIdx >= 0) cursor.getString(bodyIdx)?.trim().orEmpty() else ""
                        val dateMs = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
                        conversations[threadId] = ConversationAccumulator(
                            threadId = threadId,
                            address = address.ifEmpty { "Inconnu" },
                            snippet = body,
                            dateMs = dateMs,
                            unreadCount = if (isUnread) 1 else 0
                        )
                    } else if (isUnread) {
                        existing.unreadCount += 1
                    }
                }
            }
        } catch (e: SecurityException) {
            return SmsOpResult.Error(
                403,
                "Permission SMS refusée sur le téléphone."
            )
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lecture des conversations SMS", e)
            return SmsOpResult.Error(500, "Impossible de lire les conversations SMS.")
        }

        val result = conversations.values.map { acc ->
            SmsConversationDto(
                threadId = acc.threadId,
                address = acc.address,
                contactName = resolveContactName(acc.address),
                snippet = acc.snippet,
                dateMs = acc.dateMs,
                unreadCount = acc.unreadCount
            )
        }
        return SmsOpResult.Success(result)
    }

    fun listMessages(
        threadId: Long,
        limit: Int = DEFAULT_MESSAGES_LIMIT
    ): SmsOpResult<List<SmsMessageDto>> {
        if (!hasReadSmsPermission()) {
            return SmsOpResult.Error(
                403,
                "Activez la permission « Messages SMS » dans l'application Android NexusLink."
            )
        }
        if (threadId <= 0L) {
            return SmsOpResult.Error(400, "Identifiant de conversation invalide.")
        }

        val safeLimit = limit.coerceIn(1, 200)
        val projection = arrayOf(
            Telephony.Sms._ID,
            Telephony.Sms.THREAD_ID,
            Telephony.Sms.ADDRESS,
            Telephony.Sms.BODY,
            Telephony.Sms.DATE,
            Telephony.Sms.TYPE
        )

        val items = ArrayList<SmsMessageDto>(safeLimit)
        try {
            context.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                projection,
                "${Telephony.Sms.THREAD_ID} = ?",
                arrayOf(threadId.toString()),
                "${Telephony.Sms.DATE} DESC"
            )?.use { cursor ->
                val idIdx = cursor.getColumnIndexOrThrow(Telephony.Sms._ID)
                val addrIdx = cursor.getColumnIndex(Telephony.Sms.ADDRESS)
                val bodyIdx = cursor.getColumnIndex(Telephony.Sms.BODY)
                val dateIdx = cursor.getColumnIndex(Telephony.Sms.DATE)
                val typeIdx = cursor.getColumnIndex(Telephony.Sms.TYPE)

                while (cursor.moveToNext() && items.size < safeLimit) {
                    val id = cursor.getLong(idIdx)
                    val address = if (addrIdx >= 0) cursor.getString(addrIdx)?.trim().orEmpty() else ""
                    val body = if (bodyIdx >= 0) cursor.getString(bodyIdx).orEmpty() else ""
                    val dateMs = if (dateIdx >= 0) cursor.getLong(dateIdx) else 0L
                    val smsType = if (typeIdx >= 0) cursor.getInt(typeIdx) else Telephony.Sms.MESSAGE_TYPE_INBOX
                    val isOutgoing = smsType != Telephony.Sms.MESSAGE_TYPE_INBOX

                    items.add(
                        SmsMessageDto(
                            id = id,
                            threadId = threadId,
                            address = address,
                            body = body,
                            dateMs = dateMs,
                            isOutgoing = isOutgoing
                        )
                    )
                }
            }
        } catch (e: SecurityException) {
            return SmsOpResult.Error(403, "Permission SMS refusée sur le téléphone.")
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lecture messages thread $threadId", e)
            return SmsOpResult.Error(500, "Impossible de charger la conversation.")
        }

        // Remet les messages dans l'ordre chronologique (du plus ancien au plus récent)
        items.reverse()
        return SmsOpResult.Success(items)
    }

    fun searchContacts(
        rawQuery: String,
        limit: Int = DEFAULT_CONTACTS_LIMIT
    ): SmsOpResult<List<SmsContactDto>> {
        if (!hasContactsPermission()) {
            return SmsOpResult.Success(emptyList())
        }

        val query = rawQuery.trim()
        val safeLimit = limit.coerceIn(1, 2000)
        val projection = arrayOf(
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER
        )

        val selection = if (query.isNotEmpty()) {
            "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} LIKE ? OR ${ContactsContract.CommonDataKinds.Phone.NUMBER} LIKE ?"
        } else {
            null
        }
        val selectionArgs = if (query.isNotEmpty()) {
            val pattern = "%$query%"
            arrayOf(pattern, pattern)
        } else {
            null
        }

        val seen = HashSet<String>()
        val contacts = ArrayList<SmsContactDto>(safeLimit)

        try {
            context.contentResolver.query(
                ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
                projection,
                selection,
                selectionArgs,
                "${ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME} ASC"
            )?.use { cursor ->
                val nameIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME)
                val numIdx = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER)

                while (cursor.moveToNext() && contacts.size < safeLimit) {
                    val name = if (nameIdx >= 0) cursor.getString(nameIdx)?.trim().orEmpty() else ""
                    val number = if (numIdx >= 0) cursor.getString(numIdx)?.trim().orEmpty() else ""
                    if (number.isEmpty()) continue

                    val normalizedKey = "${name.lowercase()}|${number.replace(Regex("[^+0-9]"), "")}"
                    if (seen.add(normalizedKey)) {
                        contacts.add(
                            SmsContactDto(
                                name = name.ifEmpty { number },
                                phoneNumber = number
                            )
                        )
                    }
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Erreur recherche contacts", e)
        }

        return SmsOpResult.Success(contacts)
    }

    @Suppress("DEPRECATION")
    fun sendSms(rawAddress: String, rawBody: String): SmsOpResult<Unit> {
        if (!hasSendSmsPermission()) {
            return SmsOpResult.Error(
                403,
                "Activez la permission « Messages SMS » dans l'application Android NexusLink pour envoyer des SMS."
            )
        }

        val address = rawAddress.trim()
        val body = rawBody.trim()
        if (address.isEmpty() || body.isEmpty()) {
            return SmsOpResult.Error(400, "Numéro de téléphone et message requis.")
        }

        return try {
            val smsManager = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                context.getSystemService(SmsManager::class.java)
            } else {
                SmsManager.getDefault()
            } ?: return SmsOpResult.Error(500, "Service SMS indisponible sur ce téléphone.")

            val parts = smsManager.divideMessage(body)
            if (parts.size > 1) {
                smsManager.sendMultipartTextMessage(address, null, parts, null, null)
            } else {
                smsManager.sendTextMessage(address, null, body, null, null)
            }
            SmsOpResult.Success(Unit)
        } catch (e: SecurityException) {
            SmsOpResult.Error(403, "Permission d'envoi SMS refusée sur le téléphone.")
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lors de l'envoi du SMS vers $address", e)
            SmsOpResult.Error(500, "Impossible d'envoyer le SMS : ${e.localizedMessage ?: "erreur inconnue"}")
        }
    }

    private fun resolveContactName(address: String): String {
        if (address.isBlank() || address == "Inconnu") return address
        contactNameCache[address]?.let { return it }

        if (!hasContactsPermission()) return address

        val resolved = try {
            val lookupUri = Uri.withAppendedPath(
                ContactsContract.PhoneLookup.CONTENT_FILTER_URI,
                Uri.encode(address)
            )
            context.contentResolver.query(
                lookupUri,
                arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME),
                null,
                null,
                null
            )?.use { cursor ->
                if (cursor.moveToFirst()) {
                    cursor.getString(0)?.takeIf { it.isNotBlank() }
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            null
        } ?: address

        contactNameCache[address] = resolved
        return resolved
    }

    companion object {
        private const val TAG = "SmsManagerBridge"
        private const val DEFAULT_CONVERSATIONS_LIMIT = 60
        private const val DEFAULT_MESSAGES_LIMIT = 80
        private const val DEFAULT_CONTACTS_LIMIT = 1000
        private const val MAX_SCAN_ROWS = 2000
    }
}
