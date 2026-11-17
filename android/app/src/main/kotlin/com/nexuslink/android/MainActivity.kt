package com.nexuslink.android

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.core.content.ContextCompat
import com.nexuslink.android.network.ConnectionState
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import com.nexuslink.android.protocol.PairingQrPayload
import com.nexuslink.android.service.ConnectionForegroundService
import com.nexuslink.android.ui.NexusLinkHomeScreen
import com.nexuslink.android.ui.QrScannerView
import com.nexuslink.android.ui.theme.NexusLinkTheme
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.serialization.json.Json

class MainActivity : ComponentActivity() {

    private val json = Json { ignoreUnknownKeys = true }

    private var connectionService: ConnectionForegroundService? by mutableStateOf(null)
    private var isBound = false
    private var showQrScanner by mutableStateOf(false)
    private var uiErrorMessage: String? by mutableStateOf(null)

    private val fallbackConnectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    private val fallbackHosts = MutableStateFlow<List<DiscoveredDesktopHost>>(emptyList())
    private val fallbackDiscovering = MutableStateFlow(false)

    private val serviceConnection = object : ServiceConnection {
        override fun onServiceConnected(name: ComponentName?, service: IBinder?) {
            val binder = service as? ConnectionForegroundService.LocalBinder
            connectionService = binder?.getService()
            isBound = true
        }

        override fun onServiceDisconnected(name: ComponentName?) {
            connectionService = null
            isBound = false
        }
    }

    private val requestCameraPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            uiErrorMessage = null
            showQrScanner = true
        } else {
            uiErrorMessage = "La permission caméra est requise pour scanner le QR Code."
        }
    }

    private val requestNotificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { _ -> }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        requestNotificationPermissionIfNeeded()
        startAndBindConnectionService()

        setContent {
            NexusLinkTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val service = connectionService
                    val connectionState by (service?.connectionState ?: fallbackConnectionState).collectAsState()
                    val discoveredHosts by (service?.discoveredHosts ?: fallbackHosts).collectAsState()
                    val isDiscovering by (service?.isDiscovering ?: fallbackDiscovering).collectAsState()

                    if (showQrScanner) {
                        QrScannerView(
                            onQrCodeScanned = { rawJson ->
                                showQrScanner = false
                                handlePairingPayload(rawJson)
                            },
                            onCancel = { showQrScanner = false }
                        )
                    } else {
                        NexusLinkHomeScreen(
                            connectionState = connectionState,
                            discoveredHosts = discoveredHosts,
                            isDiscovering = isDiscovering,
                            errorMessage = uiErrorMessage,
                            onOpenQrScanner = { openQrScannerWithPermission() },
                            onSelectDiscoveredHost = { host ->
                                uiErrorMessage = null
                                connectionService?.pairWithDiscoveredHost(host)
                            },
                            onRefreshDiscovery = { connectionService?.restartDiscovery() },
                            onDisconnect = {
                                uiErrorMessage = null
                                connectionService?.disconnectAndForgetPeer()
                            }
                        )
                    }
                }
            }
        }
    }

    override fun onDestroy() {
        if (isBound) {
            unbindService(serviceConnection)
            isBound = false
        }
        super.onDestroy()
    }

    private fun startAndBindConnectionService() {
        val intent = Intent(this, ConnectionForegroundService::class.java)
        ContextCompat.startForegroundService(this, intent)
        bindService(intent, serviceConnection, Context.BIND_AUTO_CREATE)
    }

    private fun openQrScannerWithPermission() {
        val granted = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.CAMERA
        ) == PackageManager.PERMISSION_GRANTED

        if (granted) {
            uiErrorMessage = null
            showQrScanner = true
        } else {
            requestCameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) {
                requestNotificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun handlePairingPayload(rawJson: String) {
        try {
            val qrPayload = json.decodeFromString<PairingQrPayload>(rawJson.trim())
            uiErrorMessage = null
            connectionService?.pairWithQrPayload(qrPayload)
        } catch (e: Exception) {
            uiErrorMessage = "QR Code ou JSON d'appairage invalide : ${e.localizedMessage}"
        }
    }
}
