package com.clawd.phone

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
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
        internal const val VIBRATE_SHORT_MS = 200L
        internal val VIBRATE_PATTERN_ALARM = longArrayOf(0, 400, 200, 400, 200, 400)

        val KNOWN_TYPES = setOf("notification", "alarm")

        fun clampVolume(percent: Int): Float = percent.coerceIn(0, 100) / 100f
    }

    @Volatile
    private var lastPlayTime = 0L

    @Volatile
    private var volume = DEFAULT_VOLUME

    @Volatile
    private var mediaPlayer: MediaPlayer? = null

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
    }

    internal fun handleStopAlarm() {
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

    private fun playSoundForType(type: String) {
        handleStopAlarm()

        val uri = when (type) {
            "alarm" -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            else -> RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION)
        }

        try {
            mediaPlayer = MediaPlayer().apply {
                setAudioAttributes(
                    AudioAttributes.Builder()
                        .setUsage(
                            if (type == "alarm") AudioAttributes.USAGE_ALARM
                            else AudioAttributes.USAGE_NOTIFICATION
                        )
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build()
                )
                setDataSource(context, uri)
                setVolume(volume, volume)
                setOnCompletionListener { player ->
                    player.release()
                    if (this@AlarmBridge.mediaPlayer === player) {
                        this@AlarmBridge.mediaPlayer = null
                    }
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

    private fun vibrateForType(type: String) {
        val vibrator = getVibrator() ?: return

        val effect = if (type == "alarm") {
            VibrationEffect.createWaveform(VIBRATE_PATTERN_ALARM, -1)
        } else {
            VibrationEffect.createOneShot(VIBRATE_SHORT_MS, VibrationEffect.DEFAULT_AMPLITUDE)
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
