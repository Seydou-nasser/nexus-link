package com.nexuslink.android.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.Size
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size as ComposeSize
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nexuslink.android.network.AndroidTransferRecord
import com.nexuslink.android.network.ConnectionState
import com.nexuslink.android.protocol.DiscoveredDesktopHost
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Écran principal inspiré d'une mise en page mobile épurée :
 * bloc PC centré, 3 actions rapides, carte « Récent » et tuiles de raccourci.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NexusLinkHomeScreen(
    connectionState: ConnectionState,
    discoveredHosts: List<DiscoveredDesktopHost>,
    recentTransfers: List<AndroidTransferRecord>,
    isDiscovering: Boolean,
    isAccessibilityEnabled: Boolean,
    isNotificationAccessEnabled: Boolean,
    errorMessage: String?,
    onOpenQrScanner: () -> Unit,
    onSelectDiscoveredHost: (DiscoveredDesktopHost) -> Unit,
    onPickFilesToSend: () -> Unit,
    onOpenFile: (AndroidTransferRecord) -> Unit,
    onOpenAccessibilitySettings: () -> Unit,
    onOpenNotificationAccessSettings: () -> Unit,
    onRefreshDiscovery: () -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showHistoryPage by remember { mutableStateOf(false) }
    var showDisconnectConfirm by remember { mutableStateOf(false) }

    if (showHistoryPage) {
        val pcName = (connectionState as? ConnectionState.Connected)?.pcName ?: "PC"
        BackHandler { showHistoryPage = false }
        FullTransferHistoryScreen(
            transfers = recentTransfers,
            pcName = pcName,
            onOpenFile = onOpenFile,
            onBack = { showHistoryPage = false },
            modifier = modifier
        )
        return
    }

    if (showDisconnectConfirm) {
        val pcName = (connectionState as? ConnectionState.Connected)?.pcName ?: "cet ordinateur"
        AlertDialog(
            onDismissRequest = { showDisconnectConfirm = false },
            title = { Text("Déconnecter l'ordinateur ?") },
            text = {
                Text("Voulez-vous vraiment déconnecter et dissocier cet appareil de $pcName ?")
            },
            confirmButton = {
                Button(
                    onClick = {
                        showDisconnectConfirm = false
                        onDisconnect()
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.error,
                        contentColor = MaterialTheme.colorScheme.onError
                    )
                ) {
                    Text("Déconnecter")
                }
            },
            dismissButton = {
                TextButton(onClick = { showDisconnectConfirm = false }) {
                    Text("Annuler")
                }
            }
        )
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "NexusLink",
                        fontWeight = FontWeight.SemiBold
                    )
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 20.dp)
                .verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            // 1. Hero centré : Illustration PC + Nom + Statut
            HeroDesktopHeader(
                connectionState = connectionState,
                onDisconnect = onDisconnect
            )

            if (!errorMessage.isNullOrBlank()) {
                Spacer(modifier = Modifier.height(12.dp))
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(14.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        text = errorMessage,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        style = MaterialTheme.typography.bodySmall,
                        modifier = Modifier.padding(12.dp)
                    )
                }
            }

            Spacer(modifier = Modifier.height(22.dp))

            // 2. Rangée des 3 actions rapides
            val isConnected = connectionState is ConnectionState.Connected
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                QuickActionTile(
                    label = "Envoyer fichiers",
                    enabled = isConnected,
                    iconType = QuickIconType.SEND,
                    onClick = onPickFilesToSend,
                    modifier = Modifier.weight(1f)
                )
                QuickActionTile(
                    label = if (isAccessibilityEnabled) "Presse-papiers actif" else "Activer sync",
                    enabled = !isAccessibilityEnabled,
                    iconType = QuickIconType.CLIPBOARD,
                    onClick = {
                        if (!isAccessibilityEnabled) onOpenAccessibilitySettings()
                    },
                    modifier = Modifier.weight(1f)
                )
                QuickActionTile(
                    label = if (isConnected) "Déconnecter" else "Scanner QR",
                    enabled = connectionState !is ConnectionState.WaitingApproval,
                    iconType = if (isConnected) QuickIconType.DISCONNECT else QuickIconType.QR,
                    onClick = {
                        if (isConnected) showDisconnectConfirm = true else onOpenQrScanner()
                    },
                    modifier = Modifier.weight(1f)
                )
            }

            Spacer(modifier = Modifier.height(22.dp))

            if (isConnected) {
                // 3. Carte « Récent » avec Afficher plus
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Récent",
                                style = MaterialTheme.typography.titleMedium,
                                fontWeight = FontWeight.SemiBold
                            )
                            if (recentTransfers.isNotEmpty()) {
                                Text(
                                    text = "Voir plus",
                                    style = MaterialTheme.typography.labelLarge,
                                    color = MaterialTheme.colorScheme.primary,
                                    fontWeight = FontWeight.Medium,
                                    modifier = Modifier
                                        .clip(RoundedCornerShape(8.dp))
                                        .clickable { showHistoryPage = true }
                                        .padding(horizontal = 6.dp, vertical = 2.dp)
                                )
                            }
                        }

                        if (recentTransfers.isEmpty()) {
                            Text(
                                text = "Aucun fichier échangé pour le moment.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                modifier = Modifier.padding(vertical = 8.dp)
                            )
                        } else {
                            recentTransfers.take(3).forEach { transfer ->
                                RecentTransferRow(
                                    transfer = transfer,
                                    pcName = (connectionState as ConnectionState.Connected).pcName,
                                    onClick = { onOpenFile(transfer) }
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                // 4. Tuiles inférieures (style Liste Paramètres / Raccourcis)
                BottomNavigationTile(
                    title = "Partager des fichiers",
                    subtitle = "Sélectionner des photos ou documents",
                    iconType = QuickIconType.FOLDER,
                    onClick = onPickFilesToSend
                )

                Spacer(modifier = Modifier.height(10.dp))

                BottomNavigationTile(
                    title = "Presse-papiers automatique",
                    subtitle = if (isAccessibilityEnabled) {
                        "Actif • Textes et captures synchronisés"
                    } else {
                        "Inactif • Appuyez pour activer"
                    },
                    iconType = QuickIconType.CLIPBOARD,
                    showChevron = !isAccessibilityEnabled,
                    onClick = {
                        if (!isAccessibilityEnabled) onOpenAccessibilitySettings()
                    }
                )

                Spacer(modifier = Modifier.height(10.dp))

                BottomNavigationTile(
                    title = "Notifications sur le PC",
                    subtitle = if (isNotificationAccessEnabled) {
                        "Actif • Notifications et réponses synchronisées"
                    } else {
                        "Inactif • Appuyez pour autoriser"
                    },
                    iconType = QuickIconType.BELL,
                    showChevron = !isNotificationAccessEnabled,
                    onClick = {
                        if (!isNotificationAccessEnabled) onOpenNotificationAccessSettings()
                    }
                )
            } else if (connectionState !is ConnectionState.WaitingApproval) {
                // 3b. Ordinateurs à proximité (si non connecté)
                Surface(
                    color = MaterialTheme.colorScheme.surfaceContainer,
                    shape = RoundedCornerShape(20.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Ordinateurs à proximité",
                                    style = MaterialTheme.typography.titleMedium,
                                    fontWeight = FontWeight.SemiBold
                                )
                                Text(
                                    text = if (isDiscovering) "Recherche sur votre Wi-Fi…" else "Recherche en pause",
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                            OutlinedButton(onClick = onRefreshDiscovery) {
                                Text("Actualiser")
                            }
                        }

                        if (discoveredHosts.isEmpty()) {
                            Text(
                                text = "Aucun ordinateur détecté. Ouvrez NexusLink sur votre PC (même Wi-Fi) ou utilisez Scanner QR.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        } else {
                            discoveredHosts.forEach { host ->
                                Surface(
                                    onClick = { onSelectDiscoveredHost(host) },
                                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                                    shape = RoundedCornerShape(14.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(14.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Column {
                                            Text(
                                                text = host.deviceName,
                                                style = MaterialTheme.typography.bodyMedium,
                                                fontWeight = FontWeight.Medium
                                            )
                                            Text(
                                                text = "Appuyez pour associer",
                                                style = MaterialTheme.typography.labelSmall,
                                                color = MaterialTheme.colorScheme.onSurfaceVariant
                                            )
                                        }
                                        Text(
                                            text = "Connecter",
                                            style = MaterialTheme.typography.labelMedium,
                                            fontWeight = FontWeight.SemiBold,
                                            color = MaterialTheme.colorScheme.primary
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun HeroDesktopHeader(
    connectionState: ConnectionState,
    onDisconnect: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        LaptopIllustration(
            isConnected = connectionState is ConnectionState.Connected
        )

        val pcTitle = when (connectionState) {
            is ConnectionState.Connected -> connectionState.pcName
            is ConnectionState.WaitingApproval -> connectionState.pcName
            is ConnectionState.Connecting -> connectionState.targetHost
            else -> "Aucun ordinateur"
        }

        Text(
            text = pcTitle,
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )

        val (statusLabel, dotColor) = when (connectionState) {
            is ConnectionState.Connected -> "Connecté" to Color(0xFF10B981)
            is ConnectionState.WaitingApproval -> "Confirmation sur le PC" to MaterialTheme.colorScheme.primary
            is ConnectionState.Connecting -> "Connexion en cours…" to MaterialTheme.colorScheme.primary
            is ConnectionState.Error -> "Connexion interrompue" to MaterialTheme.colorScheme.error
            ConnectionState.Disconnected -> "Déconnecté" to MaterialTheme.colorScheme.onSurfaceVariant
        }

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(dotColor)
            )
            Text(
                text = statusLabel,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        if (connectionState is ConnectionState.WaitingApproval) {
            Spacer(modifier = Modifier.height(4.dp))
            Surface(
                color = MaterialTheme.colorScheme.surfaceContainerHigh,
                shape = RoundedCornerShape(16.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Text(
                        text = "Vérifiez ce code sur votre ordinateur :",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Text(
                        text = connectionState.verificationCode,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 28.sp,
                        letterSpacing = 6.sp,
                        color = MaterialTheme.colorScheme.primary
                    )
                    Button(
                        onClick = onDisconnect,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.errorContainer,
                            contentColor = MaterialTheme.colorScheme.onErrorContainer
                        )
                    ) {
                        Text("Annuler")
                    }
                }
            }
        }
    }
}

private enum class QuickIconType { SEND, CLIPBOARD, DISCONNECT, QR, FOLDER, BELL }

@Composable
private fun QuickActionTile(
    label: String,
    enabled: Boolean,
    iconType: QuickIconType,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val contentAlpha = if (enabled) 1f else 0.4f
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainer,
            shape = RoundedCornerShape(16.dp),
            modifier = Modifier
                .fillMaxWidth()
                .height(60.dp)
                .clip(RoundedCornerShape(16.dp))
                .clickable(enabled = enabled, onClick = onClick)
        ) {
            Box(contentAlignment = Alignment.Center) {
                MinimalVectorIcon(
                    type = iconType,
                    tint = MaterialTheme.colorScheme.onSurface.copy(alpha = contentAlpha),
                    modifier = Modifier.size(22.dp)
                )
            }
        }
        Text(
            text = label,
            style = MaterialTheme.typography.labelMedium,
            color = MaterialTheme.colorScheme.onSurface.copy(alpha = contentAlpha),
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            textAlign = TextAlign.Center
        )
    }
}

@Composable
private fun RecentTransferRow(
    transfer: AndroidTransferRecord,
    pcName: String,
    onClick: () -> Unit
) {
    val context = LocalContext.current
    val isMedia = transfer.mimeType.startsWith("image/") || transfer.mimeType.startsWith("video/")
    val thumbnail by produceState<Bitmap?>(initialValue = null, key1 = transfer.fileUri, key2 = transfer.completed) {
        val uri = transfer.fileUri
        if (uri != null && isMedia) {
            value = withContext(Dispatchers.IO) {
                try {
                    context.contentResolver.loadThumbnail(uri, Size(128, 128), null)
                } catch (_: Exception) {
                    if (transfer.mimeType.startsWith("image/")) {
                        try {
                            context.contentResolver.openInputStream(uri)?.use { stream ->
                                BitmapFactory.decodeStream(stream)
                            }
                        } catch (_: Exception) {
                            null
                        }
                    } else {
                        null
                    }
                }
            }
        }
    }

    val canOpen = transfer.completed && transfer.fileUri != null
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(10.dp))
            .clickable(enabled = canOpen, onClick = onClick)
            .padding(vertical = 6.dp, horizontal = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Surface(
            color = MaterialTheme.colorScheme.surfaceContainerHigh,
            shape = RoundedCornerShape(10.dp),
            modifier = Modifier.size(42.dp)
        ) {
            Box(contentAlignment = Alignment.Center) {
                val bmp = thumbnail
                if (bmp != null) {
                    Image(
                        bitmap = bmp.asImageBitmap(),
                        contentDescription = transfer.fileName,
                        contentScale = ContentScale.Crop,
                        modifier = Modifier.fillMaxSize()
                    )
                } else {
                    MinimalVectorIcon(
                        type = QuickIconType.FOLDER,
                        tint = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.size(20.dp)
                    )
                }
            }
        }
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = transfer.fileName,
                style = MaterialTheme.typography.bodyMedium,
                fontWeight = FontWeight.Medium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
            Text(
                text = if (transfer.direction == "Reçu") {
                    "Reçu de $pcName"
                } else {
                    "Envoyé vers $pcName"
                },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Text(
            text = if (transfer.completed) "✓" else "…",
            style = MaterialTheme.typography.labelLarge,
            color = if (transfer.completed) Color(0xFF10B981) else MaterialTheme.colorScheme.primary
        )
    }
}

@Composable
private fun BottomNavigationTile(
    title: String,
    subtitle: String,
    iconType: QuickIconType,
    showChevron: Boolean = true,
    onClick: () -> Unit
) {
    Surface(
        onClick = onClick,
        color = MaterialTheme.colorScheme.surfaceContainer,
        shape = RoundedCornerShape(16.dp),
        modifier = Modifier.fillMaxWidth()
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 14.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            MinimalVectorIcon(
                type = iconType,
                tint = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.size(22.dp)
            )
            Spacer(modifier = Modifier.width(14.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = title,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Medium
                )
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
            if (showChevron) {
                Text(
                    text = ">",
                    style = MaterialTheme.typography.titleMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun FullTransferHistoryScreen(
    transfers: List<AndroidTransferRecord>,
    pcName: String,
    onOpenFile: (AndroidTransferRecord) -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        text = "Historique des fichiers",
                        fontWeight = FontWeight.SemiBold
                    )
                },
                navigationIcon = {
                    TextButton(onClick = onBack) {
                        Text("← Retour")
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 20.dp, vertical = 12.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            if (transfers.isEmpty()) {
                Text(
                    text = "Aucun fichier échangé pour le moment.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                transfers.forEach { transfer ->
                    Surface(
                        color = MaterialTheme.colorScheme.surfaceContainer,
                        shape = RoundedCornerShape(16.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Box(modifier = Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                            RecentTransferRow(
                                transfer = transfer,
                                pcName = pcName,
                                onClick = { onOpenFile(transfer) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun LaptopIllustration(isConnected: Boolean) {
    val screenColor = MaterialTheme.colorScheme.surfaceContainerHigh
    val borderColor = if (isConnected) Color(0xFF10B981) else MaterialTheme.colorScheme.outline
    val baseColor = MaterialTheme.colorScheme.onSurfaceVariant

    Canvas(modifier = Modifier.size(width = 140.dp, height = 88.dp)) {
        val screenWidth = size.width * 0.72f
        val screenHeight = size.height * 0.72f
        val screenLeft = (size.width - screenWidth) / 2f

        drawRoundRect(
            color = screenColor,
            topLeft = Offset(screenLeft, 6f),
            size = ComposeSize(screenWidth, screenHeight),
            cornerRadius = CornerRadius(12f, 12f)
        )
        drawRoundRect(
            color = borderColor,
            topLeft = Offset(screenLeft, 6f),
            size = ComposeSize(screenWidth, screenHeight),
            cornerRadius = CornerRadius(12f, 12f),
            style = Stroke(width = 3f)
        )
        // Base du PC portable
        drawLine(
            color = baseColor,
            start = Offset(size.width * 0.06f, screenHeight + 14f),
            end = Offset(size.width * 0.94f, screenHeight + 14f),
            strokeWidth = 6f,
            cap = StrokeCap.Round
        )
    }
}

@Composable
private fun MinimalVectorIcon(
    type: QuickIconType,
    tint: Color,
    modifier: Modifier = Modifier
) {
    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        val stroke = Stroke(width = w * 0.085f, cap = StrokeCap.Round)

        when (type) {
            QuickIconType.SEND -> {
                val planePath = Path().apply {
                    moveTo(w * 0.14f, h * 0.18f)
                    lineTo(w * 0.88f, h * 0.50f)
                    lineTo(w * 0.14f, h * 0.82f)
                    lineTo(w * 0.28f, h * 0.50f)
                    close()
                }
                drawPath(
                    path = planePath,
                    color = tint,
                    style = Stroke(
                        width = stroke.width,
                        cap = StrokeCap.Round,
                        join = StrokeJoin.Round
                    )
                )
                drawLine(
                    color = tint,
                    start = Offset(w * 0.28f, h * 0.50f),
                    end = Offset(w * 0.86f, h * 0.50f),
                    strokeWidth = stroke.width * 0.9f,
                    cap = StrokeCap.Round
                )
            }
            QuickIconType.CLIPBOARD -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.2f, h * 0.2f),
                    size = ComposeSize(w * 0.6f, h * 0.68f),
                    cornerRadius = CornerRadius(w * 0.1f, w * 0.1f),
                    style = stroke
                )
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.35f, h * 0.1f),
                    size = ComposeSize(w * 0.3f, h * 0.16f),
                    cornerRadius = CornerRadius(w * 0.06f, w * 0.06f),
                    style = stroke
                )
            }
            QuickIconType.DISCONNECT -> {
                drawCircle(color = tint, radius = w * 0.34f, style = stroke)
                drawLine(tint, Offset(w * 0.32f, h * 0.32f), Offset(w * 0.68f, h * 0.68f), strokeWidth = stroke.width, cap = StrokeCap.Round)
                drawLine(tint, Offset(w * 0.68f, h * 0.32f), Offset(w * 0.32f, h * 0.68f), strokeWidth = stroke.width, cap = StrokeCap.Round)
            }
            QuickIconType.QR -> {
                drawRect(tint, topLeft = Offset(w * 0.15f, h * 0.15f), size = ComposeSize(w * 0.28f, h * 0.28f), style = stroke)
                drawRect(tint, topLeft = Offset(w * 0.57f, h * 0.15f), size = ComposeSize(w * 0.28f, h * 0.28f), style = stroke)
                drawRect(tint, topLeft = Offset(w * 0.15f, h * 0.57f), size = ComposeSize(w * 0.28f, h * 0.28f), style = stroke)
                drawRect(tint, topLeft = Offset(w * 0.6f, h * 0.6f), size = ComposeSize(w * 0.22f, h * 0.22f), style = stroke)
            }
            QuickIconType.FOLDER -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.12f, h * 0.26f),
                    size = ComposeSize(w * 0.76f, h * 0.54f),
                    cornerRadius = CornerRadius(w * 0.1f, w * 0.1f),
                    style = stroke
                )
                drawLine(tint, Offset(w * 0.18f, h * 0.26f), Offset(w * 0.45f, h * 0.26f), strokeWidth = stroke.width, cap = StrokeCap.Round)
            }
            QuickIconType.BELL -> {
                drawRoundRect(
                    color = tint,
                    topLeft = Offset(w * 0.22f, h * 0.18f),
                    size = ComposeSize(w * 0.56f, h * 0.52f),
                    cornerRadius = CornerRadius(w * 0.26f, w * 0.26f),
                    style = stroke
                )
                drawLine(tint, Offset(w * 0.14f, h * 0.70f), Offset(w * 0.86f, h * 0.70f), strokeWidth = stroke.width, cap = StrokeCap.Round)
                drawCircle(color = tint, radius = w * 0.08f, center = Offset(w * 0.50f, h * 0.82f))
            }
        }
    }
}
