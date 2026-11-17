package com.nexuslink.android.network

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import android.util.Log
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.net.Inet4Address
import java.nio.charset.StandardCharsets

/**
 * Gère la découverte automatique des PC NexusLink sur le réseau Wi-Fi local via mDNS (NsdManager).
 */
class NsdDiscoveryManager(context: Context) {

    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val wifiManager =
        context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager

    private var multicastLock: WifiManager.MulticastLock? = null
    private var discoveryListener: NsdManager.DiscoveryListener? = null

    private val _discoveredHosts = MutableStateFlow<List<DiscoveredDesktopHost>>(emptyList())
    val discoveredHosts: StateFlow<List<DiscoveredDesktopHost>> = _discoveredHosts.asStateFlow()

    private val _isDiscovering = MutableStateFlow(false)
    val isDiscovering: StateFlow<Boolean> = _isDiscovering.asStateFlow()

    fun startDiscovery() {
        if (_isDiscovering.value) return

        acquireMulticastLock()

        val listener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                Log.d(TAG, "Découverte mDNS démarrée pour $regType")
                _isDiscovering.value = true
            }

            override fun onServiceFound(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service mDNS trouvé : ${serviceInfo.serviceName}")
                if (serviceInfo.serviceType.contains("_nexuslink._tcp")) {
                    resolveServiceInfo(serviceInfo)
                }
            }

            override fun onServiceLost(serviceInfo: NsdServiceInfo) {
                Log.d(TAG, "Service mDNS perdu : ${serviceInfo.serviceName}")
                _discoveredHosts.value = _discoveredHosts.value.filterNot {
                    it.serviceName == serviceInfo.serviceName
                }
            }

            override fun onDiscoveryStopped(serviceType: String) {
                Log.d(TAG, "Découverte mDNS arrêtée")
                _isDiscovering.value = false
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Échec du démarrage mDNS (code=$errorCode)")
                _isDiscovering.value = false
                stopDiscovery()
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                Log.e(TAG, "Échec de l'arrêt mDNS (code=$errorCode)")
                _isDiscovering.value = false
            }
        }

        discoveryListener = listener
        try {
            nsdManager.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
        } catch (e: Exception) {
            Log.e(TAG, "Erreur lors de discoverServices", e)
            _isDiscovering.value = false
            releaseMulticastLock()
        }
    }

    fun stopDiscovery() {
        discoveryListener?.let { listener ->
            try {
                nsdManager.stopServiceDiscovery(listener)
            } catch (e: Exception) {
                Log.w(TAG, "Erreur lors de stopServiceDiscovery", e)
            }
        }
        discoveryListener = null
        _isDiscovering.value = false
        releaseMulticastLock()
    }

    @Suppress("DEPRECATION")
    private fun resolveServiceInfo(serviceInfo: NsdServiceInfo) {
        try {
            nsdManager.resolveService(serviceInfo, object : NsdManager.ResolveListener {
                override fun onResolveFailed(info: NsdServiceInfo, errorCode: Int) {
                    Log.w(TAG, "Échec de résolution mDNS pour ${info.serviceName} (code=$errorCode)")
                }

                override fun onServiceResolved(resolved: NsdServiceInfo) {
                    val hostAddress = resolved.hostAddresses
                        ?.firstOrNull { it is Inet4Address }
                        ?.hostAddress
                        ?: resolved.host?.hostAddress
                        ?: return

                    val deviceNameAttr = resolved.attributes["device_name"]
                        ?.let { String(it, StandardCharsets.UTF_8) }
                        ?.takeIf { it.isNotBlank() }
                        ?: resolved.serviceName.removePrefix("NexusLink-")

                    val udpPortAttr = resolved.attributes["udp_port"]
                        ?.let { String(it, StandardCharsets.UTF_8).toIntOrNull() }
                        ?: 52841

                    val host = DiscoveredDesktopHost(
                        serviceName = resolved.serviceName,
                        deviceName = deviceNameAttr,
                        hostAddress = hostAddress,
                        wsPort = resolved.port,
                        udpPort = udpPortAttr
                    )

                    val updated = _discoveredHosts.value
                        .filterNot { it.serviceName == host.serviceName } + host
                    _discoveredHosts.value = updated
                    Log.d(TAG, "PC résolu via mDNS : $host")
                }
            })
        } catch (e: Exception) {
            Log.e(TAG, "Exception pendant resolveService", e)
        }
    }

    private fun acquireMulticastLock() {
        try {
            if (multicastLock == null) {
                multicastLock = wifiManager.createMulticastLock("NexusLinkMdnsLock").apply {
                    setReferenceCounted(false)
                }
            }
            if (multicastLock?.isHeld == false) {
                multicastLock?.acquire()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Impossible d'acquérir le MulticastLock", e)
        }
    }

    private fun releaseMulticastLock() {
        try {
            if (multicastLock?.isHeld == true) {
                multicastLock?.release()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Impossible de libérer le MulticastLock", e)
        }
    }

    companion object {
        private const val TAG = "NsdDiscoveryManager"
        private const val SERVICE_TYPE = "_nexuslink._tcp."
    }
}
