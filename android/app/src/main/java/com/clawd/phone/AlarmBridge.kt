package com.clawd.phone

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import android.webkit.JavascriptInterface

class AlarmBridge(
    private val context: Context,
    private val handler: Handler = Handler(Looper.getMainLooper())
) {

    companion object {
        private const val TAG = "AlarmBridge"
        const val COOLDOWN_MS = 10_000L
        const val DEFAULT_VOLUME = 0.7f
        const val AUTO_STOP_MS = 5_000L
        internal const val VIBRATE_SHORT_MS = 200L
        internal val VIBRATE_PATTERN_ALARM = longArrayOf(0, 400, 200, 400, 200, 400)

        val KNOWN_TYPES = setOf("permission", "finished")

        fun clampVolume(percent: Int): Float = percent.coerceIn(0, 100) / 100f

        fun amplitudeForIntensity(intensity: Int): Int = when (intensity) {
            Prefs.VIBRATE_LIGHT -> 64
            Prefs.VIBRATE_MEDIUM -> 128
            Prefs.VIBRATE_STRONG -> 255
            else -> 0
        }
    }

    @Volatile
    private var lastPlayTime = 0L

    @Volatile
    private var volume = DEFAULT_VOLUME

    @Volatile
    private var mediaPlayer: MediaPlayer? = null

    private var autoStopRunnable: Runnable? = null

    @JavascriptInterface
    fun playAlarm(type: String) {
        handler.post { handlePlayAlarm(type) }
    }

    @JavascriptInterface
    fun stopAlarm() {
        handler.post { handleStopAlarm() }
    }

    @JavascriptInterface
    fun setVolume(percent: Int) {
        val clamped = clampVolume(percent)
        handler.post {
            volume = clamped
            mediaPlayer?.setVolume(volume, volume)
        }
    }

    internal fun handlePlayAlarm(type: String) {
        if (type !in KNOWN_TYPES) {
            Log.w(TAG, "Unknown alarm type: $type")
            return
        }

        val prefs = context.getSharedPreferences(Prefs.NAME, Context.MODE_PRIVATE)
        val soundEnabled = prefs.getBoolean(Prefs.KEY_SOUND_ENABLED, true)
        if (!soundEnabled) {
            Log.d(TAG, "Sound disabled in settings, skipping")
            return
        }

        val now = System.currentTimeMillis()
        if (now - lastPlayTime < COOLDOWN_MS) {
            Log.d(TAG, "Cooldown active, skipping $type")
            return
        }

        val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val ringerMode = audioManager.ringerMode
        val shouldPlaySound = ringerMode == AudioManager.RINGER_MODE_NORMAL
        val shouldVibrate = ringerMode != AudioManager.RINGER_MODE_SILENT

        if (!shouldPlaySound && !shouldVibrate) {
            Log.d(TAG, "Silent mode, skipping all")
            return
        }

        lastPlayTime = now

        if (shouldPlaySound) {
            playSoundForType(type)
        }
        if (shouldVibrate) {
            vibrateForType(type)
        }

        scheduleAutoStop()
    }

    internal fun handleStopAlarm() {
        cancelAutoStop()
        try {
            mediaPlayer?.let { player ->
                if (player.isPlaying) {
                    player.stop()
                }
                player.release()
            }
        } catch (e: IllegalStateException) {
            Log.w(TAG, "Error stopping alarm: ${e.message}")
        }
        mediaPlayer = null
        cancelVibration()
    }

    internal fun isCooldownActive(): Boolean {
        return System.currentTimeMillis() - lastPlayTime < COOLDOWN_MS
    }

    internal fun resetCooldown() {
        lastPlayTime = 0L
    }

    internal fun getLastPlayTime(): Long = lastPlayTime

    private fun scheduleAutoStop() {
        cancelAutoStop()
        val runnable = Runnable { handleStopAlarm() }
        autoStopRunnable = runnable
        handler.postDelayed(runnable, AUTO_STOP_MS)
    }

    private fun cancelAutoStop() {
        autoStopRunnable?.let { handler.removeCallbacks(it) }
        autoStopRunnable = null
    }

    private fun playSoundForType(type: String) {
        handleStopAlarm()

        try {
            val uri = resolveRingtoneUri(type) ?: return
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(context, uri)
                setVolume(volume, volume)
                isLooping = false
                setOnCompletionListener { player ->
                    player.release()
                    if (this@AlarmBridge.mediaPlayer === player) {
                        this@AlarmBridge.mediaPlayer = null
                    }
                    cancelAutoStop()
                }
                setOnErrorListener { player, _, _ ->
                    Log.w(TAG, "MediaPlayer error for type=$type")
                    player.release()
                    if (this@AlarmBridge.mediaPlayer === player) {
                        this@AlarmBridge.mediaPlayer = null
                    }
                    true
                }
                setOnPreparedListener { player ->
                    player.start()
                }
                prepareAsync()
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to play sound for type=$type: ${e.message}")
            mediaPlayer = null
        }
    }

    internal fun resolveRingtoneUri(type: String): Uri? {
        val prefs = context.getSharedPreferences(Prefs.NAME, Context.MODE_PRIVATE)
        val prefKey = when (type) {
            "permission" -> Prefs.KEY_SOUND_PERMISSION_URI
            "finished" -> Prefs.KEY_SOUND_FINISHED_URI
            else -> null
        }

        val savedUri = prefKey?.let { prefs.getString(it, null) }
        if (!savedUri.isNullOrBlank()) {
            return Uri.parse(savedUri)
        }

        return RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
    }

    private fun vibrateForType(type: String) {
        val vibrator = getVibrator() ?: return
        val prefs = context.getSharedPreferences(Prefs.NAME, Context.MODE_PRIVATE)
        val intensity = prefs.getInt(Prefs.KEY_VIBRATE_INTENSITY, Prefs.VIBRATE_MEDIUM)

        if (intensity == Prefs.VIBRATE_OFF) return

        val amplitude = amplitudeForIntensity(intensity)

        val effect = if (type == "permission") {
            VibrationEffect.createWaveform(
                VIBRATE_PATTERN_ALARM,
                intArrayOf(0, amplitude, 0, amplitude, 0, amplitude),
                -1
            )
        } else {
            VibrationEffect.createOneShot(VIBRATE_SHORT_MS, amplitude)
        }

        vibrator.vibrate(effect)
    }

    private fun cancelVibration() {
        getVibrator()?.cancel()
    }

    private fun getVibrator(): Vibrator? {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val vm = context.getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as? VibratorManager
            vm?.defaultVibrator
        } else {
            @Suppress("DEPRECATION")
            context.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
        }
    }
}
