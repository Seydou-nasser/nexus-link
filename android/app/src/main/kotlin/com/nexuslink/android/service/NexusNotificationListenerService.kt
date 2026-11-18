package com.nexuslink.android.service

import android.app.Notification
import android.app.Person
import android.app.RemoteInput
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.drawable.Drawable
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import android.util.Base64
import android.util.Log
import com.nexuslink.android.protocol.NotificationPostedPayload
import java.io.ByteArrayOutputStream
import java.lang.ref.WeakReference
import java.util.concurrent.ConcurrentHashMap

/**
 * Intercepte les notifications Android et permet au PC d'y répondre directement (RemoteInput)
 * ou de les fermer à distance.
 */
class NexusNotificationListenerService : NotificationListenerService() {

    private val replyActions = ConcurrentHashMap<String, Pair<Notification.Action, RemoteInput>>()

    override fun onListenerConnected() {
        super.onListenerConnected()
        activeInstance = WeakReference(this)
        Log.d(TAG, "NotificationListenerService connecté")
        if (ConnectionForegroundService.isConnected()) {
            syncAllActiveNotifications()
        }
    }

    override fun onListenerDisconnected() {
        activeInstance = null
        replyActions.clear()
        super.onListenerDisconnected()
    }

    override fun onNotificationPosted(sbn: StatusBarNotification?) {
        val notifSbn = sbn ?: return
        processPostedNotification(notifSbn)
    }

    fun syncAllActiveNotifications() {
        if (!ConnectionForegroundService.isConnected()) return
        val current = try {
            activeNotifications
        } catch (e: Exception) {
            Log.w(TAG, "Impossible de lire activeNotifications : ${e.message}")
            null
        } ?: return

        current.forEach { sbn ->
            processPostedNotification(sbn)
        }
    }

    private fun processPostedNotification(notifSbn: StatusBarNotification) {
        if (!ConnectionForegroundService.isConnected()) return

        // Ignore nos propres notifications et les notifications permanentes (services en cours)
        if (notifSbn.packageName == packageName) return
        val notification = notifSbn.notification ?: return
        if ((notification.flags and Notification.FLAG_ONGOING_EVENT) != 0) return
        if ((notification.flags and Notification.FLAG_FOREGROUND_SERVICE) != 0) return

        // Évite les doublons pour les résumés de groupe si des notifications enfants actives existent
        if ((notification.flags and Notification.FLAG_GROUP_SUMMARY) != 0) {
            if (hasActiveGroupChildren(notifSbn)) return
        }

        val extras = notification.extras ?: Bundle.EMPTY
        val (title, bodyText) = extractTitleAndBody(extras)

        if (title.isEmpty() && bodyText.isEmpty()) return

        val appName = resolveAppName(notifSbn.packageName)
        val iconBase64 = extractAppIconBase64(notifSbn.packageName)

        // Recherche d'une action de réponse rapide (RemoteInput : SMS, WhatsApp, Telegram, etc.)
        var canReply = false
        val actionTitles = mutableListOf<String>()
        notification.actions?.forEach { action ->
            val label = action.title?.toString()?.trim().orEmpty()
            if (label.isNotEmpty()) actionTitles.add(label)

            val remoteInput = action.remoteInputs?.firstOrNull()
            if (remoteInput != null && action.actionIntent != null && !canReply) {
                replyActions[notifSbn.key] = action to remoteInput
                canReply = true
            }
        }

        val payload = NotificationPostedPayload(
            notificationKey = notifSbn.key,
            packageName = notifSbn.packageName,
            appName = appName,
            title = title.ifEmpty { appName },
            text = bodyText,
            canReply = canReply,
            actions = actionTitles,
            iconBase64 = iconBase64
        )
        ConnectionForegroundService.sendNotificationPosted(payload)
    }

    private fun hasActiveGroupChildren(summarySbn: StatusBarNotification): Boolean {
        val groupKey = summarySbn.notification?.group ?: return false
        val current = try {
            activeNotifications
        } catch (_: Exception) {
            null
        } ?: return false

        return current.any { candidate ->
            candidate.key != summarySbn.key &&
                candidate.packageName == summarySbn.packageName &&
                candidate.notification?.group == groupKey &&
                ((candidate.notification.flags and Notification.FLAG_GROUP_SUMMARY) == 0)
        }
    }

    private fun extractTitleAndBody(extras: Bundle): Pair<String, String> {
        val conversationTitle = extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)
            ?.toString()?.trim().orEmpty()
        val rawTitle = extras.getCharSequence(Notification.EXTRA_TITLE)
            ?.toString()?.trim().orEmpty()
        val bigTitle = extras.getCharSequence(Notification.EXTRA_TITLE_BIG)
            ?.toString()?.trim().orEmpty()
        val title = conversationTitle.ifEmpty { rawTitle.ifEmpty { bigTitle } }

        val messagesText = extractMessagingStyleText(extras)
        val bigText = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?.toString()?.trim().orEmpty()
        val textLines = extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES)
            ?.mapNotNull { it?.toString()?.trim()?.takeIf(String::isNotEmpty) }
            ?.joinToString("\n")
            .orEmpty()
        val plainText = extras.getCharSequence(Notification.EXTRA_TEXT)
            ?.toString()?.trim().orEmpty()
        val subText = extras.getCharSequence(Notification.EXTRA_SUB_TEXT)
            ?.toString()?.trim().orEmpty()
        val summaryText = extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)
            ?.toString()?.trim().orEmpty()

        val bodyText = messagesText
            .ifEmpty { bigText }
            .ifEmpty { textLines }
            .ifEmpty { plainText }
            .ifEmpty { subText }
            .ifEmpty { summaryText }

        return title to bodyText
    }

    @Suppress("DEPRECATION")
    private fun extractMessagingStyleText(extras: Bundle): String {
        val rawMessages = extras.getParcelableArray(Notification.EXTRA_MESSAGES) ?: return ""
        val lines = rawMessages.mapNotNull { item ->
            val bundle = item as? Bundle ?: return@mapNotNull null
            val msgText = bundle.getCharSequence("text")?.toString()?.trim().orEmpty()
            if (msgText.isEmpty()) return@mapNotNull null

            val sender = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                bundle.getParcelable("sender_person", Person::class.java)?.name?.toString()?.trim()
                    ?: bundle.getCharSequence("sender")?.toString()?.trim()
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                bundle.getParcelable<Person>("sender_person")?.name?.toString()?.trim()
                    ?: bundle.getCharSequence("sender")?.toString()?.trim()
            } else {
                bundle.getCharSequence("sender")?.toString()?.trim()
            }

            if (!sender.isNullOrEmpty()) "$sender : $msgText" else msgText
        }
        return lines.joinToString("\n")
    }

    override fun onNotificationRemoved(sbn: StatusBarNotification?) {
        val key = sbn?.key ?: return
        replyActions.remove(key)
        if (sbn.packageName == packageName) return
        ConnectionForegroundService.sendNotificationRemoved(key)
    }

    fun executeRemoteReply(notificationKey: String, replyText: String) {
        val (action, remoteInput) = replyActions[notificationKey] ?: return
        val replyIntent = Intent()
        val results = Bundle().apply {
            putCharSequence(remoteInput.resultKey, replyText)
        }
        RemoteInput.addResultsToIntent(arrayOf(remoteInput), replyIntent, results)
        try {
            action.actionIntent.send(this, 0, replyIntent)
        } catch (e: Exception) {
            Log.e(TAG, "Échec de l'envoi de la réponse à la notification", e)
        }
    }

    fun executeRemoteDismiss(notificationKey: String) {
        replyActions.remove(notificationKey)
        try {
            cancelNotification(notificationKey)
        } catch (e: Exception) {
            Log.w(TAG, "Impossible de fermer la notification : ${e.message}")
        }
    }

    private fun resolveAppName(pkg: String): String {
        return try {
            val info = packageManager.getApplicationInfo(pkg, 0)
            packageManager.getApplicationLabel(info).toString()
        } catch (_: Exception) {
            pkg
        }
    }

    private fun extractAppIconBase64(pkg: String): String? {
        return try {
            val drawable = packageManager.getApplicationIcon(pkg)
            val bitmap = drawableToBitmap(drawable, 48)
            val out = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 90, out)
            bitmap.recycle()
            Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
        } catch (_: Exception) {
            null
        }
    }

    private fun drawableToBitmap(drawable: Drawable, sizePx: Int): Bitmap {
        val bitmap = Bitmap.createBitmap(sizePx, sizePx, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bitmap)
        drawable.setBounds(0, 0, canvas.width, canvas.height)
        drawable.draw(canvas)
        return bitmap
    }

    companion object {
        private const val TAG = "NexusNotifListener"

        @Volatile
        private var activeInstance: WeakReference<NexusNotificationListenerService>? = null

        fun replyToNotification(notificationKey: String, replyText: String) {
            activeInstance?.get()?.executeRemoteReply(notificationKey, replyText)
        }

        fun dismissNotification(notificationKey: String) {
            activeInstance?.get()?.executeRemoteDismiss(notificationKey)
        }

        fun syncActiveNotifications() {
            activeInstance?.get()?.syncAllActiveNotifications()
        }

        fun isNotificationListenerEnabled(context: Context): Boolean {
            val componentName = ComponentName(context, NexusNotificationListenerService::class.java)
            val flat = Settings.Secure.getString(
                context.contentResolver,
                "enabled_notification_listeners"
            ) ?: return false
            return flat.contains(componentName.flattenToString())
        }
    }
}
