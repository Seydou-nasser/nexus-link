package com.nexuslink.android

import android.Manifest
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.os.IBinder
import android.provider.Settings
import android.widget.Toast
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
import com.nexuslink.android.network.AndroidTransferRecord
import com.nexuslink.android.network.ConnectionState
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import com.nexuslink.android.protocol.PairingQrPayload
import com.nexuslink.android.service.ConnectionForegroundService
import com.nexuslink.android.service.NexusAccessibilityService
import com.nexuslink.android.service.NexusNotificationListenerService
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
    private var isAccessibilityEnabled by mutableStateOf(false)
    private var isNotificationAccessEnabled by mutableStateOf(false)
    private var isAllFilesAccessEnabled by mutableStateOf(false)
    private var uiErrorMessage: String? by mutableStateOf(null)

    private val fallbackConnectionState = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    private val fallbackHosts = MutableStateFlow<List<DiscoveredDesktopHost>>(emptyList())
    private val fallbackTransfers = MutableStateFlow<List<AndroidTransferRecord>>(emptyList())
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

    private val requestMediaPermissionsLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { _ -> }

    private val pickFilesLauncher = registerForActivityResult(
        ActivityResultContracts.OpenMultipleDocuments()
    ) { uris ->
        if (uris.isNotEmpty()) {
            connectionService?.sendFiles(uris)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        requestNotificationPermissionIfNeeded()
        requestMediaPermissionIfNeeded()
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
                    val recentTransfers by (service?.recentTransfers ?: fallbackTransfers).collectAsState()
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
                            recentTransfers = recentTransfers,
                            isDiscovering = isDiscovering,
                            isAccessibilityEnabled = isAccessibilityEnabled,
                            isNotificationAccessEnabled = isNotificationAccessEnabled,
                            isAllFilesAccessEnabled = isAllFilesAccessEnabled,
                            errorMessage = uiErrorMessage,
                            onOpenQrScanner = { openQrScannerWithPermission() },
                            onSelectDiscoveredHost = { host ->
                                uiErrorMessage = null
                                connectionService?.pairWithDiscoveredHost(host)
                            },
                            onPickFilesToSend = {
                                pickFilesLauncher.launch(arrayOf("*/*"))
                            },
                            onOpenFile = { transfer -> openTransferFile(transfer) },
                            onOpenAccessibilitySettings = {
                                startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
                            },
                            onOpenNotificationAccessSettings = {
                                startActivity(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
                            },
                            onOpenAllFilesAccessSettings = {
                                openAllFilesAccessSettings()
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

    override fun onResume() {
        super.onResume()
        isAccessibilityEnabled = NexusAccessibilityService.isServiceEnabled(this)
        isNotificationAccessEnabled = NexusNotificationListenerService.isNotificationListenerEnabled(this)
        isAllFilesAccessEnabled = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            Environment.isExternalStorageManager()
        } else {
            true
        }
    }

    private fun openAllFilesAccessSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            try {
                val intent = Intent(
                    Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                    Uri.parse("package:$packageName")
                )
                startActivity(intent)
            } catch (_: Exception) {
                startActivity(Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION))
            }
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) {
            connectionService?.syncLocalClipboardToPc()
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

    private fun requestMediaPermissionIfNeeded() {
        val requiredPermissions = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            arrayOf(
                Manifest.permission.READ_MEDIA_IMAGES,
                Manifest.permission.READ_MEDIA_VIDEO
            )
        } else {
            arrayOf(Manifest.permission.READ_EXTERNAL_STORAGE)
        }

        val missingPermissions = requiredPermissions.filter { perm ->
            ContextCompat.checkSelfPermission(this, perm) != PackageManager.PERMISSION_GRANTED
        }

        if (missingPermissions.isNotEmpty()) {
            requestMediaPermissionsLauncher.launch(missingPermissions.toTypedArray())
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

    private fun openTransferFile(transfer: AndroidTransferRecord) {
        val uri = transfer.fileUri ?: return
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, transfer.mimeType)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }
        try {
            startActivity(Intent.createChooser(intent, transfer.fileName))
        } catch (_: Exception) {
            Toast.makeText(
                this,
                "Aucune application disponible pour ouvrir ce fichier",
                Toast.LENGTH_SHORT
            ).show()
        }
    }
}
