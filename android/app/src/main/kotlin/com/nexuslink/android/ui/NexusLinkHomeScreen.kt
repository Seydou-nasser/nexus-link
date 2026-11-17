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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
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
    errorMessage: String?,
    onOpenQrScanner: () -> Unit,
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

            // 2. Association par QR Code (uniquement si non connecté)
            if (connectionState !is ConnectionState.Connected) {
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
                            text = "Ouvrez NexusLink sur votre ordinateur puis scannez le QR Code affiché à l'écran.",
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

                // 3. Ordinateurs détectés sur le même réseau Wi-Fi
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
                                    color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                                    shape = RoundedCornerShape(10.dp),
                                    modifier = Modifier.fillMaxWidth()
                                ) {
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .padding(12.dp),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text(
                                            text = host.deviceName,
                                            style = MaterialTheme.typography.bodyMedium,
                                            fontWeight = FontWeight.Medium
                                        )
                                        Text(
                                            text = "Disponible",
                                            style = MaterialTheme.typography.labelSmall,
                                            color = Color(0xFF10B981)
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
        is ConnectionState.Connecting -> Triple(
            "Connexion en cours…",
            "Établissement de la liaison avec votre ordinateur",
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

            if (connectionState is ConnectionState.Connected || connectionState is ConnectionState.Connecting) {
                Button(
                    onClick = onDisconnect,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MaterialTheme.colorScheme.errorContainer,
                        contentColor = MaterialTheme.colorScheme.onErrorContainer
                    )
                ) {
                    Text("Déconnecter cet ordinateur")
                }
            }
        }
    }
}
