package com.nexuslink.android.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.nexuslink.android.network.ConnectionState
import com.nexuslink.android.protocol.DiscoveredDesktopHost

/**
 * Écran principal d'appairage et de suivi de la liaison entre le téléphone et l'ordinateur.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun NexusLinkHomeScreen(
    connectionState: ConnectionState,
    discoveredHosts: List<DiscoveredDesktopHost>,
    isDiscovering: Boolean,
    isAccessibilityEnabled: Boolean,
    errorMessage: String?,
    onOpenQrScanner: () -> Unit,
    onSelectDiscoveredHost: (DiscoveredDesktopHost) -> Unit,
    onOpenAccessibilitySettings: () -> Unit,
    onRefreshDiscovery: () -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier
) {
    Scaffold(
        modifier = modifier.fillMaxSize(),
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text(
                            text = "NexusLink",
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Votre téléphone relié à votre PC",
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            )
        }
    ) { innerPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .padding(horizontal = 16.dp, vertical = 12.dp)
                .verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // 1. Carte d'état de la liaison
            ConnectionStatusCard(
                connectionState = connectionState,
                onDisconnect = onDisconnect
            )

            if (!errorMessage.isNullOrBlank()) {
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = RoundedCornerShape(12.dp),
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

            // 2. Presse-papiers automatique en arrière-plan (lorsque connecté)
            if (connectionState is ConnectionState.Connected) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "Presse-papiers automatique",
                                style = MaterialTheme.typography.titleSmall,
                                fontWeight = FontWeight.SemiBold
                            )
                            Text(
                                text = if (isAccessibilityEnabled) "Actif" else "Inactif",
                                style = MaterialTheme.typography.labelMedium,
                                fontWeight = FontWeight.SemiBold,
                                color = if (isAccessibilityEnabled) Color(0xFF10B981) else MaterialTheme.colorScheme.error
                            )
                        }
                        Text(
                            text = if (isAccessibilityEnabled) {
                                "Tout ce que vous copiez sur le téléphone ou le PC est synchronisé automatiquement."
                            } else {
                                "Activez l’accessibilité NexusLink pour que ce que vous copiez depuis n’importe quelle application soit envoyé automatiquement au PC."
                            },
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                        if (!isAccessibilityEnabled) {
                            Button(
                                onClick = onOpenAccessibilitySettings,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text("Activer la synchronisation automatique")
                            }
                        }
                    }
                }
            }

            // 3. Association par QR Code ou sélection directe (uniquement si non connecté)
            if (connectionState !is ConnectionState.Connected &&
                connectionState !is ConnectionState.WaitingApproval
            ) {
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(12.dp)
                    ) {
                        Text(
                            text = "Associer un ordinateur",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.SemiBold
                        )
                        Text(
                            text = "Scannez le QR Code affiché sur votre ordinateur, ou sélectionnez-le dans la liste ci-dessous.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )

                        Button(
                            onClick = onOpenQrScanner,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text("Scanner le QR Code")
                        }
                    }
                }

                // 3. Ordinateurs détectés sur le même réseau Wi-Fi (cliquables)
                Card(
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(16.dp)
                ) {
                    Column(
                        modifier = Modifier.padding(16.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = "Ordinateurs à proximité",
                                    style = MaterialTheme.typography.titleSmall,
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
                                text = "Aucun ordinateur détecté pour le moment. Vérifiez que votre PC est allumé sur le même réseau Wi-Fi.",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                        } else {
                            discoveredHosts.forEach { host ->
                                Surface(
                                    onClick = { onSelectDiscoveredHost(host) },
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                    shape = RoundedCornerShape(12.dp),
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
                                                text = "Appuyez pour demander la connexion",
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

            Spacer(modifier = Modifier.height(12.dp))
        }
    }
}

@Composable
private fun ConnectionStatusCard(
    connectionState: ConnectionState,
    onDisconnect: () -> Unit
) {
    val (title, subtitle, accentColor) = when (connectionState) {
        is ConnectionState.Connected -> Triple(
            "Connecté à ${connectionState.pcName}",
            "Votre téléphone et votre ordinateur sont reliés",
            Color(0xFF10B981)
        )
        is ConnectionState.WaitingApproval -> Triple(
            "Confirmez sur ${connectionState.pcName}",
            "Vérifiez que ce code correspond à celui affiché sur votre ordinateur :",
            Color(0xFF6366F1)
        )
        is ConnectionState.Connecting -> Triple(
            "Connexion en cours…",
            "Établissement de la liaison avec ${connectionState.targetHost}",
            Color(0xFF6366F1)
        )
        is ConnectionState.Error -> Triple(
            "Connexion interrompue",
            connectionState.message,
            MaterialTheme.colorScheme.error
        )
        ConnectionState.Disconnected -> Triple(
            "Non connecté",
            "En attente de liaison avec votre ordinateur",
            MaterialTheme.colorScheme.onSurfaceVariant
        )
    }

    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.surfaceContainerHigh
        )
    ) {
        Column(
            modifier = Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.SemiBold,
                color = accentColor
            )
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            if (connectionState is ConnectionState.WaitingApproval) {
                Surface(
                    color = MaterialTheme.colorScheme.surface,
                    shape = RoundedCornerShape(12.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp)
                ) {
                    Text(
                        text = connectionState.verificationCode,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.Bold,
                        fontSize = 28.sp,
                        letterSpacing = 6.sp,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(vertical = 14.dp, horizontal = 16.dp)
                    )
                }
            }

            if (connectionState is ConnectionState.Connected ||
                connectionState is ConnectionState.Connecting ||
                connectionState is ConnectionState.WaitingApproval
            ) {
                Button(
                    onClick = onDisconnect,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer
                    )
                ) {
                    Text(
                        if (connectionState is ConnectionState.Connected)
                            "Déconnecter cet ordinateur"
                        else
                            "Annuler"
                    )
                }
            }
        }
    }
}
