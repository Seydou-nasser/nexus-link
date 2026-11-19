package com.nexuslink.android.service

import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.ImageReader
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager
import androidx.core.app.NotificationCompat
import com.nexuslink.android.R
import com.nexuslink.android.ScreenCapturePermissionActivity
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.ByteArrayOutputStream
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.max
import kotlin.math.roundToInt

/**
 * Service de premier plan (FOREGROUND_SERVICE_MEDIA_PROJECTION) qui capture l'écran Android
 * via VirtualDisplay + ImageReader et pousse des frames JPEG basse latence au PC.
 */
class ScreenMirrorService : Service() {

    private val httpClient = OkHttpClient.Builder()
        .connectTimeout(2, TimeUnit.SECONDS)
        .writeTimeout(2, TimeUnit.SECONDS)
        .readTimeout(2, TimeUnit.SECONDS)
        .build()

    private val isUploading = AtomicBoolean(false)
    private var mediaProjection: MediaProjection? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var imageReader: ImageReader? = null
    private var captureThread: HandlerThread? = null
    private var captureHandler: Handler? = null
    private var reusableBitmap: Bitmap? = null

    private val projectionCallback = object : MediaProjection.Callback() {
        override fun onStop() {
            Log.d(TAG, "MediaProjection arrêté par le système")
            stopCapture()
            ConnectionForegroundService.sendScreenMirrorState(state = "STOPPED")
            stopSelf()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            stopCapture()
            ConnectionForegroundService.sendScreenMirrorState(state = "STOPPED")
            stopForeground(STOP_FOREGROUND_REMOVE)
            stopSelf()
            return START_NOT_STICKY
        }

        val resultCode = intent?.getIntExtra(EXTRA_RESULT_CODE, Activity.RESULT_CANCELED)
            ?: Activity.RESULT_CANCELED
        val resultData: Intent? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            intent?.getParcelableExtra(EXTRA_RESULT_DATA, Intent::class.java)
        } else {
            @Suppress("DEPRECATION")
            intent?.getParcelableExtra(EXTRA_RESULT_DATA)
        }

        if (resultCode != Activity.RESULT_OK || resultData == null) {
            ConnectionForegroundService.sendScreenMirrorState(
                state = "ERROR",
                errorMessage = "Données d'autorisation de capture invalides."
            )
            stopSelf()
            return START_NOT_STICKY
        }

        promoteToForeground()
        startCapture(resultCode, resultData)
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        stopCapture()
        super.onDestroy()
    }

    private fun promoteToForeground() {
        val manager = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            "Recopie d'écran NexusLink",
            NotificationManager.IMPORTANCE_LOW
        )
        manager.createNotificationChannel(channel)

        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("NexusLink — Recopie d'écran")
            .setContentText("Partage d'écran actif vers votre ordinateur")
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startCapture(resultCode: Int, resultData: Intent) {
        stopCapture()

        val projectionManager =
            getSystemService(Context.MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
        val projection = try {
            projectionManager.getMediaProjection(resultCode, resultData)
        } catch (e: Exception) {
            Log.e(TAG, "Impossible d'obtenir MediaProjection : ${e.message}", e)
            ConnectionForegroundService.sendScreenMirrorState(
                state = "ERROR",
                errorMessage = "Échec d'initialisation de la capture d'écran."
            )
            stopSelf()
            return
        }

        if (projection == null) {
            ConnectionForegroundService.sendScreenMirrorState(
                state = "ERROR",
                errorMessage = "Autorisation MediaProjection indisponible."
            )
            stopSelf()
            return
        }

        val (rawWidth, rawHeight, densityDpi) = readDisplayMetrics()
        val scale = (MAX_CAPTURE_DIMENSION.toFloat() / max(rawWidth, rawHeight)).coerceAtMost(1f)
        val captureWidth = ((rawWidth * scale).roundToInt().coerceAtLeast(2) / 2) * 2
        val captureHeight = ((rawHeight * scale).roundToInt().coerceAtLeast(2) / 2) * 2

        val thread = HandlerThread("NexusScreenCapture").apply { start() }
        val handler = Handler(thread.looper)
        captureThread = thread
        captureHandler = handler

        projection.registerCallback(projectionCallback, handler)
        mediaProjection = projection

        val reader = ImageReader.newInstance(
            captureWidth,
            captureHeight,
            PixelFormat.RGBA_8888,
            2
        )
        imageReader = reader

        reader.setOnImageAvailableListener({ ir ->
            val image = try {
                ir.acquireLatestImage()
            } catch (_: Exception) {
                null
            } ?: return@setOnImageAvailableListener

            try {
                if (!isUploading.compareAndSet(false, true)) {
                    return@setOnImageAvailableListener
                }

                val plane = image.planes.firstOrNull()
                if (plane == null) {
                    isUploading.set(false)
                    return@setOnImageAvailableListener
                }

                val pixelStride = plane.pixelStride
                val rowStride = plane.rowStride
                val rowPadding = rowStride - pixelStride * captureWidth
                val bitmapWidth = captureWidth + rowPadding / pixelStride

                val bmp = reusableBitmap?.takeIf {
                    it.width == bitmapWidth && it.height == captureHeight && !it.isRecycled
                } ?: Bitmap.createBitmap(bitmapWidth, captureHeight, Bitmap.Config.ARGB_8888).also {
                    reusableBitmap?.recycle()
                    reusableBitmap = it
                }

                val buffer = plane.buffer
                buffer.rewind()
                bmp.copyPixelsFromBuffer(buffer)

                val cropped = if (rowPadding > 0) {
                    Bitmap.createBitmap(bmp, 0, 0, captureWidth, captureHeight)
                } else {
                    bmp
                }

                val jpegOut = ByteArrayOutputStream(32 * 1024)
                cropped.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, jpegOut)
                if (cropped !== bmp) {
                    cropped.recycle()
                }

                uploadFrameToPc(jpegOut.toByteArray())
            } catch (e: Exception) {
                Log.w(TAG, "Erreur capture frame : ${e.message}")
            } finally {
                image.close()
                isUploading.set(false)
            }
        }, handler)

        virtualDisplay = projection.createVirtualDisplay(
            "NexusLinkMirror",
            captureWidth,
            captureHeight,
            densityDpi,
            DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR,
            reader.surface,
            null,
            handler
        )

        ConnectionForegroundService.sendScreenMirrorState(
            state = "ACTIVE",
            width = captureWidth,
            height = captureHeight
        )
        Log.d(TAG, "Recopie d'écran démarrée : ${captureWidth}x$captureHeight")
    }

    private fun uploadFrameToPc(jpegBytes: ByteArray) {
        val peerInfo = ConnectionForegroundService.activeHttpPeerInfo() ?: return
        val (host, port, secret) = peerInfo
        val url = "http://$host:$port/api/v1/screen/frame"
        val body = jpegBytes.toRequestBody(JPEG_MEDIA_TYPE)
        val request = Request.Builder()
            .url(url)
            .addHeader("Authorization", "Bearer $secret")
            .post(body)
            .build()

        httpClient.newCall(request).execute().use { /* frame consommée */ }
    }

    private fun readDisplayMetrics(): Triple<Int, Int, Int> {
        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        val densityDpi = resources.displayMetrics.densityDpi
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            val bounds = wm.maximumWindowMetrics.bounds
            Triple(bounds.width().coerceAtLeast(2), bounds.height().coerceAtLeast(2), densityDpi)
        } else {
            val metrics = DisplayMetrics()
            @Suppress("DEPRECATION")
            wm.defaultDisplay.getRealMetrics(metrics)
            Triple(metrics.widthPixels.coerceAtLeast(2), metrics.heightPixels.coerceAtLeast(2), metrics.densityDpi)
        }
    }

    private fun stopCapture() {
        try {
            virtualDisplay?.release()
        } catch (_: Exception) {
        }
        virtualDisplay = null

        try {
            imageReader?.setOnImageAvailableListener(null, null)
            imageReader?.close()
        } catch (_: Exception) {
        }
        imageReader = null

        try {
            mediaProjection?.unregisterCallback(projectionCallback)
            mediaProjection?.stop()
        } catch (_: Exception) {
        }
        mediaProjection = null

        captureThread?.quitSafely()
        captureThread = null
        captureHandler = null

        reusableBitmap?.recycle()
        reusableBitmap = null
        isUploading.set(false)
    }

    companion object {
        private const val TAG = "NexusScreenMirror"
        private const val CHANNEL_ID = "nexuslink_mirror_channel"
        private const val NOTIFICATION_ID = 1003
        private const val EXTRA_RESULT_CODE = "result_code"
        private const val EXTRA_RESULT_DATA = "result_data"
        private const val ACTION_STOP = "com.nexuslink.android.ACTION_STOP_MIRROR"
        private const val MAX_CAPTURE_DIMENSION = 960
        private const val JPEG_QUALITY = 72
        private val JPEG_MEDIA_TYPE = "image/jpeg".toMediaType()

        fun requestStart(context: Context) {
            val intent = Intent(context, ScreenCapturePermissionActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        }

        fun startWithPermission(context: Context, resultCode: Int, data: Intent) {
            val intent = Intent(context, ScreenMirrorService::class.java).apply {
                putExtra(EXTRA_RESULT_CODE, resultCode)
                putExtra(EXTRA_RESULT_DATA, data)
            }
            context.startForegroundService(intent)
        }

        fun stopMirroring(context: Context) {
            val intent = Intent(context, ScreenMirrorService::class.java).apply {
                action = ACTION_STOP
            }
            try {
                context.startService(intent)
            } catch (_: Exception) {
            }
        }
    }
}
