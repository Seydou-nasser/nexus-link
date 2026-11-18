package com.nexuslink.android.service

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.graphics.PixelFormat
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.text.TextUtils
import android.util.Log
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent

/**
 * Service d'accessibilité NexusLink :
 * Détecte uniquement les actions de copie ou changements d'application (sans perturber le clavier)
 * pour synchroniser automatiquement le presse-papiers en arrière-plan.
 */
class NexusAccessibilityService : AccessibilityService() {

    private val mainHandler = Handler(Looper.getMainLooper())
    private var pendingCheckRunnable: Runnable? = null
    private var isProbing = false
    private var lastActivePackage: String? = null

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val evt = event ?: return
        val pkg = evt.packageName?.toString().orEmpty()
        if (pkg.isEmpty() || pkg == packageName || isKeyboardPackage(pkg)) {
            return
        }

        val isScreenshotOrSystemUi = pkg == "com.android.systemui" ||
            pkg == "android" ||
            pkg.contains("screenshot", ignoreCase = true) ||
            pkg.contains("smartcapture", ignoreCase = true) ||
            pkg.contains("screencapture", ignoreCase = true)

        val shouldProbe = when {
            isScreenshotOrSystemUi && (
                evt.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED ||
                    evt.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED ||
                    evt.eventType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED
                ) -> true
            evt.eventType == AccessibilityEvent.TYPE_VIEW_CLICKED -> isCopyActionEvent(evt)
            evt.eventType == AccessibilityEvent.TYPE_NOTIFICATION_STATE_CHANGED -> isCopyActionEvent(evt)
            evt.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                if (pkg != lastActivePackage) {
                    lastActivePackage = pkg
                    true
                } else {
                    false
                }
            }
            else -> false
        }

        if (shouldProbe) {
            scheduleBackgroundClipboardCheck()
        }
    }

    override fun onInterrupt() {
        pendingCheckRunnable?.let { mainHandler.removeCallbacks(it) }
    }

    private fun isKeyboardPackage(pkg: String): Boolean {
        val lower = pkg.lowercase()
        return lower.contains("inputmethod") ||
            lower.contains("keyboard") ||
            lower.contains("gboard") ||
            lower.contains("swiftkey") ||
            lower.contains("honeyboard")
    }

    private fun isCopyActionEvent(event: AccessibilityEvent): Boolean {
        val combinedText = buildString {
            event.text.forEach { append(it).append(' ') }
            event.contentDescription?.let { append(it) }
        }.lowercase()

        return combinedText.contains("copi") ||
            combinedText.contains("copy") ||
            combinedText.contains("couper") ||
            combinedText.contains("cut") ||
            combinedText.contains("presse-papiers") ||
            combinedText.contains("clipboard")
    }

    private fun scheduleBackgroundClipboardCheck() {
        pendingCheckRunnable?.let { mainHandler.removeCallbacks(it) }
        val runnable = Runnable {
            if (isProbing || !ConnectionForegroundService.isConnected()) return@Runnable
            probeClipboardWithFocusedOverlay()
        }
        pendingCheckRunnable = runnable
        mainHandler.postDelayed(runnable, 250L)
    }

    private fun probeClipboardWithFocusedOverlay() {
        val windowManager = getSystemService(Context.WINDOW_SERVICE) as? WindowManager ?: return
        isProbing = true
        var removed = false

        lateinit var probeView: View
        val cleanup = {
            if (!removed) {
                removed = true
                isProbing = false
                try {
                    windowManager.removeViewImmediate(probeView)
                } catch (_: Exception) {
                }
            }
        }

        probeView = object : View(this) {
            override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
                super.onWindowFocusChanged(hasWindowFocus)
                if (hasWindowFocus) {
                    try {
                        ConnectionForegroundService.syncClipboardFromAccessibility(
                            this@NexusAccessibilityService
                        )
                    } finally {
                        mainHandler.post { cleanup() }
                    }
                }
            }
        }.apply {
            isFocusable = true
            isFocusableInTouchMode = true
        }

        val params = WindowManager.LayoutParams(
            1,
            1,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL or
                WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            softInputMode = WindowManager.LayoutParams.SOFT_INPUT_STATE_UNCHANGED
        }

        try {
            windowManager.addView(probeView, params)
            probeView.requestFocus()
            mainHandler.postDelayed({ cleanup() }, 300L)
        } catch (e: Exception) {
            Log.w(TAG, "Impossible de lire le presse-papiers en arrière-plan : ${e.message}")
            isProbing = false
        }
    }

    companion object {
        private const val TAG = "NexusAccessibilitySvc"

        fun isServiceEnabled(context: Context): Boolean {
            val expectedId = "${context.packageName}/${NexusAccessibilityService::class.java.canonicalName}"
            val enabledServices = Settings.Secure.getString(
                context.contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES
            ) ?: return false
            val splitter = TextUtils.SimpleStringSplitter(':')
            splitter.setString(enabledServices)
            while (splitter.hasNext()) {
                if (splitter.next().equals(expectedId, ignoreCase = true)) {
                    return true
                }
            }
            return false
        }
    }
}
