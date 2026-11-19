package com.nexuslink.android.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.DisplayMetrics
import android.util.Log
import android.view.Choreographer
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.view.accessibility.AccessibilityNodeInfo
import android.widget.FrameLayout
import com.nexuslink.android.network.UdpInputEvent
import com.nexuslink.android.network.UdpInputReceiver
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlin.math.hypot

/**
 * Gère le curseur virtuel affiché en surimpression (TYPE_ACCESSIBILITY_OVERLAY)
 * via accélération matérielle GPU (translationX/Y synchronisée sur Choreographer VSync)
 * et traduit les événements UDP du PC en gestes Android / saisies clavier.
 */
class CursorOverlayController(
    private val service: AccessibilityService,
    private val onReturnToPc: () -> Unit
) {
    private val mainHandler = Handler(Looper.getMainLooper())
    private val windowManager = service.getSystemService(Context.WINDOW_SERVICE) as WindowManager

    private var overlayContainer: FrameLayout? = null
    private var pointerView: PointerView? = null
    @Volatile
    private var isActive = false

    private var screenWidth = 1080f
    private var screenHeight = 2400f
    private var cursorX = 540f
    private var cursorY = 1200f
    private var entryEdge = "RIGHT"

    private val pendingDx = AtomicInteger(0)
    private val pendingDy = AtomicInteger(0)
    private val frameScheduled = AtomicBoolean(false)

    private var previousButtons = 0
    private var returnGraceUntilMs = 0L
    @Volatile
    private var mirrorInputActive = false

    private var leftPressed = false
    private var pressStartX = 0f
    private var pressStartY = 0f
    private var pressStartTimeMs = 0L
    private var consecutiveReleasedMoves = 0
    private var screenMetricsReady = false
    private var holdPromoteRunnable: Runnable? = null
    private var liveStrokeActive = false
    private var strokeEverPromoted = false
    private var activeStroke: GestureDescription.StrokeDescription? = null
    private var strokeInFlight = false
    private var pendingRelease = false
    private var strokeLastX = 0f
    private var strokeLastY = 0f

    private val frameCallback = Choreographer.FrameCallback {
        frameScheduled.set(false)
        applyPendingMouseDelta()
    }

    fun activateFromPc(edge: String?, normalizedPosition: Double?) {
        pendingDx.set(0)
        pendingDy.set(0)
        frameScheduled.set(false)

        mainHandler.post {
            refreshScreenMetrics()
            entryEdge = edge ?: "RIGHT"
            val norm = (normalizedPosition ?: 0.5).coerceIn(0.0, 1.0).toFloat()

            when (entryEdge) {
                "LEFT" -> {
                    cursorX = (screenWidth - ENTRY_OFFSET_PX).coerceAtLeast(0f)
                    cursorY = norm * screenHeight
                }
                "BOTTOM" -> {
                    cursorX = norm * screenWidth
                    cursorY = ENTRY_OFFSET_PX.coerceAtMost(screenHeight)
                }
                else -> {
                    cursorX = ENTRY_OFFSET_PX.coerceAtMost(screenWidth)
                    cursorY = norm * screenHeight
                }
            }

            previousButtons = 0
            returnGraceUntilMs = System.currentTimeMillis() + 300L
            isActive = true
            Log.d(TAG, "Curseur virtuel activé ($entryEdge -> x=$cursorX, y=$cursorY)")
            ensureOverlayAttached()
            updatePointerTranslation()
        }
    }

    fun deactivate() {
        isActive = false
        pendingDx.set(0)
        pendingDy.set(0)
        frameScheduled.set(false)

        mainHandler.post {
            Choreographer.getInstance().removeFrameCallback(frameCallback)
            forceReleaseLeftTouch()
            previousButtons = 0
            overlayContainer?.let { container ->
                try {
                    windowManager.removeViewImmediate(container)
                } catch (_: Exception) {
                }
            }
            overlayContainer = null
            pointerView = null
        }
    }

    fun handleUdpEvent(event: UdpInputEvent) {
        val isAbsolute = (event.flags and FLAG_ABSOLUTE) != 0

        if (!isActive && !isAbsolute && !mirrorInputActive) {
            return
        }

        if (event.eventType == UdpInputReceiver.EVENT_MOUSE_MOVE) {
            if (isAbsolute) {
                mainHandler.post {
                    if (!screenMetricsReady) {
                        refreshScreenMetrics()
                    }
                    mirrorInputActive = true
                    cursorX = (event.dxOrCode.coerceIn(0, 10000) / 10000f) * screenWidth
                    cursorY = (event.dyOrMods.coerceIn(0, 10000) / 10000f) * screenHeight
                    if (isActive) {
                        updatePointerTranslation()
                    }
                    if (leftPressed) {
                        if ((event.buttonState and 0x01) == 0) {
                            val elapsed = System.currentTimeMillis() - pressStartTimeMs
                            if (elapsed > 500L && ++consecutiveReleasedMoves >= 5) {
                                Log.w(TAG, "Relâchement auto après perte UDP détectée")
                                previousButtons = event.buttonState
                                handleLeftUp()
                            }
                        } else {
                            consecutiveReleasedMoves = 0
                            handleLeftMoveWhilePressed()
                        }
                    }
                }
                return
            }

            pendingDx.addAndGet(event.dxOrCode)
            pendingDy.addAndGet(event.dyOrMods)
            if (frameScheduled.compareAndSet(false, true)) {
                mainHandler.post {
                    if (isActive) {
                        Choreographer.getInstance().postFrameCallback(frameCallback)
                    } else {
                        frameScheduled.set(false)
                    }
                }
            }
            return
        }

        mainHandler.post {
            if (isActive) {
                // Applique d'abord tout déplacement en attente pour un clic précis au pixel près
                applyPendingMouseDelta()
                if (!isActive) return@post
            } else if (!isAbsolute && !mirrorInputActive) {
                return@post
            }

            if (isAbsolute) {
                refreshScreenMetrics()
                mirrorInputActive = true
                cursorX = (event.dxOrCode.coerceIn(0, 10000) / 10000f) * screenWidth
                cursorY = (event.dyOrMods.coerceIn(0, 10000) / 10000f) * screenHeight
            }

            when (event.eventType) {
                UdpInputReceiver.EVENT_MOUSE_BUTTON -> {
                    val buttons = event.buttonState
                    val leftWasDown = (previousButtons and 0x01) != 0
                    val leftIsDown = (buttons and 0x01) != 0
                    val rightWasDown = (previousButtons and 0x02) != 0
                    val rightIsDown = (buttons and 0x02) != 0
                    val middleWasDown = (previousButtons and 0x04) != 0
                    val middleIsDown = (buttons and 0x04) != 0

                    if (!leftWasDown && leftIsDown) {
                        handleLeftDown(cursorX, cursorY)
                    } else if (leftWasDown && !leftIsDown) {
                        handleLeftUp()
                    }

                    if (!rightWasDown && rightIsDown) {
                        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_BACK)
                    }
                    if (!middleWasDown && middleIsDown) {
                        service.performGlobalAction(AccessibilityService.GLOBAL_ACTION_HOME)
                    }

                    previousButtons = buttons
                }

                UdpInputReceiver.EVENT_MOUSE_WHEEL -> {
                    val deltaSteps = event.dyOrMods
                    if (deltaSteps != 0) {
                        val scrollOffset = (deltaSteps * 140f).coerceIn(-600f, 600f)
                        val startY = cursorY.coerceIn(40f, (screenHeight - 40f).coerceAtLeast(40f))
                        val endY = (startY + scrollOffset).coerceIn(10f, (screenHeight - 10f).coerceAtLeast(10f))
                        dispatchSwipe(cursorX, startY, cursorX, endY, 120L)
                    }
                }

                UdpInputReceiver.EVENT_KEY_EVENT -> {
                    if (event.buttonState == 1) {
                        injectKeyPress(event.dxOrCode, event.dyOrMods)
                    }
                }
            }
        }
    }

    private fun applyPendingMouseDelta() {
        if (!isActive) return
        val dx = pendingDx.getAndSet(0)
        val dy = pendingDy.getAndSet(0)
        if (dx == 0 && dy == 0) return

        val nextX = cursorX + dx.toFloat()
        val nextY = cursorY + dy.toFloat()

        val canReturn = System.currentTimeMillis() >= returnGraceUntilMs
        val crossedBack = canReturn && when (entryEdge) {
            "LEFT" -> nextX > screenWidth + RETURN_THRESHOLD_PX
            "BOTTOM" -> nextY < -RETURN_THRESHOLD_PX
            else -> nextX < -RETURN_THRESHOLD_PX
        }

        if (crossedBack) {
            Log.d(TAG, "Retour curseur vers le PC ($entryEdge)")
            deactivate()
            onReturnToPc()
            return
        }

        cursorX = nextX.coerceIn(0f, (screenWidth - 1f).coerceAtLeast(1f))
        cursorY = nextY.coerceIn(0f, (screenHeight - 1f).coerceAtLeast(1f))
        updatePointerTranslation()
        if (leftPressed) {
            handleLeftMoveWhilePressed()
        }
    }

    private fun ensureOverlayAttached() {
        if (overlayContainer != null && pointerView != null) return

        val density = service.resources.displayMetrics.density
        val cursorPx = (24f * density).toInt().coerceAtLeast(48)

        val container = FrameLayout(service)
        val view = PointerView(service, density)
        container.addView(view, FrameLayout.LayoutParams(cursorPx, cursorPx))

        val params = WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE or
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN or
                WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
        }

        try {
            windowManager.addView(container, params)
            overlayContainer = container
            pointerView = view
        } catch (e: Exception) {
            Log.e(TAG, "Impossible d'afficher l'overlay curseur : ${e.message}", e)
        }
    }

    private fun updatePointerTranslation() {
        val view = pointerView ?: return
        view.translationX = cursorX
        view.translationY = cursorY
    }

    private fun refreshScreenMetrics() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = windowManager.maximumWindowMetrics.bounds
            screenWidth = bounds.width().toFloat().coerceAtLeast(1f)
            screenHeight = bounds.height().toFloat().coerceAtLeast(1f)
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            windowManager.defaultDisplay.getRealMetrics(metrics)
            screenWidth = metrics.widthPixels.toFloat().coerceAtLeast(1f)
            screenHeight = metrics.heightPixels.toFloat().coerceAtLeast(1f)
        }
        screenMetricsReady = true
    }

    private fun handleLeftDown(x: Float, y: Float) {
        cancelHoldPromotion()
        leftPressed = true
        liveStrokeActive = false
        strokeEverPromoted = false
        pendingRelease = false
        pressStartX = x
        pressStartY = y
        pressStartTimeMs = System.currentTimeMillis()
        consecutiveReleasedMoves = 0

        val runnable = Runnable {
            holdPromoteRunnable = null
            if (leftPressed && !liveStrokeActive) {
                promoteToLiveStroke()
            }
        }
        holdPromoteRunnable = runnable
        mainHandler.postDelayed(runnable, LONG_PRESS_PROMOTE_MS)
    }

    private fun handleLeftMoveWhilePressed() {
        if (!leftPressed) return
        if (!liveStrokeActive) {
            val movedDist = hypot(cursorX - pressStartX, cursorY - pressStartY)
            if (movedDist > DRAG_THRESHOLD_PX) {
                cancelHoldPromotion()
                promoteToLiveStroke()
            }
        } else {
            pumpContinuousStroke()
        }
    }

    private fun handleLeftUp() {
        cancelHoldPromotion()
        val wasPressed = leftPressed
        val wasLive = liveStrokeActive
        val wasPromoted = strokeEverPromoted
        leftPressed = false

        if (!wasPressed) {
            return
        }

        if (!wasLive && !wasPromoted) {
            // Clic simple court : geste natif en un coup (30 ms), jamais d'appui long
            dispatchTap(cursorX, cursorY)
        } else if (wasLive) {
            pendingRelease = true
            pumpContinuousStroke()
        }
    }

    private fun forceReleaseLeftTouch() {
        cancelHoldPromotion()
        leftPressed = false
        if (liveStrokeActive || activeStroke != null) {
            pendingRelease = true
            pumpContinuousStroke()
        }
    }

    private fun cancelHoldPromotion() {
        holdPromoteRunnable?.let { mainHandler.removeCallbacks(it) }
        holdPromoteRunnable = null
    }

    private fun promoteToLiveStroke() {
        liveStrokeActive = true
        strokeEverPromoted = true
        pendingRelease = false
        val path = Path().apply {
            moveTo(pressStartX, pressStartY)
            lineTo(cursorX, cursorY)
        }
        strokeLastX = cursorX
        strokeLastY = cursorY
        val stroke = GestureDescription.StrokeDescription(path, 0L, LIVE_STROKE_STEP_MS, true)
        dispatchContinuousStroke(stroke, willContinue = true)
    }

    private fun pumpContinuousStroke() {
        if (strokeInFlight) return
        val current = activeStroke ?: return

        if (pendingRelease || !leftPressed) {
            pendingRelease = false
            liveStrokeActive = false
            // Lève toujours le doigt strictement sur place sans suivre les mouvements post-relâchement
            val endPath = Path().apply {
                moveTo(strokeLastX, strokeLastY)
                lineTo(strokeLastX, strokeLastY)
            }
            val endStroke = current.continueStroke(endPath, 0L, LIVE_RELEASE_STEP_MS, false)
            dispatchContinuousStroke(endStroke, willContinue = false)
            return
        }

        // Doigt immobile : rien à envoyer. Un trait envoyé avec willContinue=true laisse le doigt
        // posé tout seul ; la chaîne reprendra au prochain déplacement ou au relâchement.
        val moved = cursorX != strokeLastX || cursorY != strokeLastY
        if (!moved) return

        val path = Path().apply {
            moveTo(strokeLastX, strokeLastY)
            lineTo(cursorX, cursorY)
        }
        strokeLastX = cursorX
        strokeLastY = cursorY

        val nextStroke = current.continueStroke(path, 0L, LIVE_STROKE_STEP_MS, true)
        dispatchContinuousStroke(nextStroke, willContinue = true)
    }

    private fun dispatchContinuousStroke(
        stroke: GestureDescription.StrokeDescription,
        willContinue: Boolean
    ) {
        activeStroke = if (willContinue) stroke else null
        strokeInFlight = true
        val dispatched = service.dispatchGesture(
            GestureDescription.Builder().addStroke(stroke).build(),
            object : AccessibilityService.GestureResultCallback() {
                override fun onCompleted(gestureDescription: GestureDescription?) {
                    strokeInFlight = false
                    if (willContinue) {
                        pumpContinuousStroke()
                    } else {
                        liveStrokeActive = false
                    }
                }

                override fun onCancelled(gestureDescription: GestureDescription?) {
                    Log.w(TAG, "Geste continu annulé par Android (onCancelled)")
                    strokeInFlight = false
                    activeStroke = null
                    liveStrokeActive = false
                    leftPressed = false
                    pendingRelease = false
                }
            },
            null
        )
        if (!dispatched) {
            Log.w(TAG, "dispatchGesture a renvoyé false pour le geste continu")
            strokeInFlight = false
            activeStroke = null
            liveStrokeActive = false
            leftPressed = false
            pendingRelease = false
        }
    }

    private fun dispatchTap(x: Float, y: Float) {
        val path = Path().apply { moveTo(x, y) }
        val stroke = GestureDescription.StrokeDescription(path, 0L, 30L)
        service.dispatchGesture(
            GestureDescription.Builder().addStroke(stroke).build(),
            null,
            null
        )
    }

    private fun dispatchSwipe(startX: Float, startY: Float, endX: Float, endY: Float, durationMs: Long) {
        val path = Path().apply {
            moveTo(startX, startY)
            lineTo(endX, endY)
        }
        val stroke = GestureDescription.StrokeDescription(path, 0L, durationMs)
        service.dispatchGesture(
            GestureDescription.Builder().addStroke(stroke).build(),
            null,
            null
        )
    }

    private fun injectKeyPress(vkCode: Int, mods: Int) {
        val root = service.rootInActiveWindow ?: return
        val focused = root.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: return

        try {
            val currentText = focused.text?.toString().orEmpty()
            val updatedText: String? = when (vkCode) {
                0x08 -> if (currentText.isNotEmpty()) currentText.dropLast(1) else null
                0x0D -> {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        focused.performAction(AccessibilityNodeInfo.AccessibilityAction.ACTION_IME_ENTER.id)
                        null
                    } else {
                        currentText + "\n"
                    }
                }
                else -> {
                    val ch = mapVirtualKeyToChar(vkCode, (mods and 0x02) != 0)
                    if (ch != null) currentText + ch else null
                }
            }

            if (updatedText != null) {
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, updatedText)
                }
                focused.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
            }
        } finally {
            focused.recycle()
            root.recycle()
        }
    }

    private fun mapVirtualKeyToChar(vkCode: Int, shift: Boolean): Char? {
        return when (vkCode) {
            0x20 -> ' '
            in 0x30..0x39 -> if (!shift) ('0' + (vkCode - 0x30)) else when (vkCode) {
                0x31 -> '!'
                0x32 -> '@'
                0x33 -> '#'
                0x34 -> '$'
                0x35 -> '%'
                0x36 -> '^'
                0x37 -> '&'
                0x38 -> '*'
                0x39 -> '('
                0x30 -> ')'
                else -> null
            }
            in 0x41..0x5A -> {
                val base = ('a' + (vkCode - 0x41))
                if (shift) base.uppercaseChar() else base
            }
            0xBE -> if (shift) '>' else '.'
            0xBC -> if (shift) '<' else ','
            0xBF -> if (shift) '?' else '/'
            0xBA -> if (shift) ':' else ';'
            0xBD -> if (shift) '_' else '-'
            0xBB -> if (shift) '+' else '='
            else -> null
        }
    }

    private class PointerView(context: Context, density: Float) : View(context) {
        private val scale = (density / 2f).coerceAtLeast(1f)
        private val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }
        private val strokePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.parseColor("#111827")
            style = Paint.Style.STROKE
            strokeWidth = 2.5f * scale
            strokeJoin = Paint.Join.ROUND
        }
        private val arrowPath = Path().apply {
            moveTo(2f * scale, 2f * scale)
            lineTo(2f * scale, 34f * scale)
            lineTo(10f * scale, 26f * scale)
            lineTo(17f * scale, 40f * scale)
            lineTo(22f * scale, 37f * scale)
            lineTo(15f * scale, 23f * scale)
            lineTo(27f * scale, 23f * scale)
            close()
        }

        override fun onDraw(canvas: Canvas) {
            super.onDraw(canvas)
            canvas.drawPath(arrowPath, fillPaint)
            canvas.drawPath(arrowPath, strokePaint)
        }
    }

    companion object {
        private const val TAG = "NexusCursorOverlay"
        private const val ENTRY_OFFSET_PX = 28f
        private const val RETURN_THRESHOLD_PX = 16f
        private const val FLAG_ABSOLUTE = 0x01
        private const val DRAG_THRESHOLD_PX = 10f
        private const val LONG_PRESS_PROMOTE_MS = 260L
        private const val LIVE_STROKE_STEP_MS = 35L
        private const val LIVE_RELEASE_STEP_MS = 10L
    }
}
