package com.clawd.phone

import android.content.Context
import android.content.SharedPreferences
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Vibrator
import android.os.VibratorManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.mockito.kotlin.any
import org.mockito.kotlin.eq
import org.mockito.kotlin.mock
import org.mockito.kotlin.never
import org.mockito.kotlin.verify
import org.mockito.kotlin.whenever

class AlarmBridgeTest {

    private lateinit var mockContext: Context
    private lateinit var mockHandler: Handler
    private lateinit var mockPrefs: SharedPreferences
    private lateinit var bridge: AlarmBridge

    @Before
    fun setUp() {
        mockContext = mock()
        mockHandler = mock()
        mockPrefs = mock()
        whenever(mockContext.getSharedPreferences(eq(Prefs.NAME), eq(Context.MODE_PRIVATE)))
            .thenReturn(mockPrefs)
        whenever(mockPrefs.getBoolean(eq(Prefs.KEY_SOUND_ENABLED), any())).thenReturn(true)
        whenever(mockPrefs.getInt(eq(Prefs.KEY_VIBRATE_INTENSITY), any())).thenReturn(Prefs.VIBRATE_MEDIUM)
        bridge = AlarmBridge(mockContext, mockHandler)
    }

    @Test
    fun `clampVolume returns 0 for negative values`() {
        assertEquals(0f, AlarmBridge.clampVolume(-10), 0.001f)
    }

    @Test
    fun `clampVolume returns 0 for zero`() {
        assertEquals(0f, AlarmBridge.clampVolume(0), 0.001f)
    }

    @Test
    fun `clampVolume returns correct float for 1`() {
        assertEquals(0.01f, AlarmBridge.clampVolume(1), 0.001f)
    }

    @Test
    fun `clampVolume returns 0_5 for 50`() {
        assertEquals(0.5f, AlarmBridge.clampVolume(50), 0.001f)
    }

    @Test
    fun `clampVolume returns 1_0 for 100`() {
        assertEquals(1.0f, AlarmBridge.clampVolume(100), 0.001f)
    }

    @Test
    fun `clampVolume clamps above 100`() {
        assertEquals(1.0f, AlarmBridge.clampVolume(150), 0.001f)
    }

    @Test
    fun `KNOWN_TYPES contains permission and finished`() {
        assertTrue(AlarmBridge.KNOWN_TYPES.contains("permission"))
        assertTrue(AlarmBridge.KNOWN_TYPES.contains("finished"))
        assertEquals(2, AlarmBridge.KNOWN_TYPES.size)
    }

    @Test
    fun `KNOWN_TYPES rejects old and unknown types`() {
        assertFalse(AlarmBridge.KNOWN_TYPES.contains("notification"))
        assertFalse(AlarmBridge.KNOWN_TYPES.contains("alarm"))
        assertFalse(AlarmBridge.KNOWN_TYPES.contains("unknown"))
        assertFalse(AlarmBridge.KNOWN_TYPES.contains(""))
    }

    @Test
    fun `COOLDOWN_MS is 10 seconds`() {
        assertEquals(10_000L, AlarmBridge.COOLDOWN_MS)
    }

    @Test
    fun `AUTO_STOP_MS is 5 seconds`() {
        assertEquals(5_000L, AlarmBridge.AUTO_STOP_MS)
    }

    @Test
    fun `VIBRATE_PATTERN_ALARM starts with 0 delay`() {
        assertEquals(0L, AlarmBridge.VIBRATE_PATTERN_ALARM[0])
    }

    @Test
    fun `VIBRATE_PATTERN_ALARM has 6 segments`() {
        assertEquals(6, AlarmBridge.VIBRATE_PATTERN_ALARM.size)
    }

    @Test
    fun `amplitudeForIntensity maps correctly`() {
        assertEquals(0, AlarmBridge.amplitudeForIntensity(Prefs.VIBRATE_OFF))
        assertEquals(64, AlarmBridge.amplitudeForIntensity(Prefs.VIBRATE_LIGHT))
        assertEquals(128, AlarmBridge.amplitudeForIntensity(Prefs.VIBRATE_MEDIUM))
        assertEquals(255, AlarmBridge.amplitudeForIntensity(Prefs.VIBRATE_STRONG))
    }

    @Test
    fun `isCooldownActive returns false before first play`() {
        assertFalse(bridge.isCooldownActive())
    }

    @Test
    fun `getLastPlayTime returns 0 initially`() {
        assertEquals(0L, bridge.getLastPlayTime())
    }

    @Test
    fun `resetCooldown resets lastPlayTime to 0`() {
        bridge.resetCooldown()
        assertEquals(0L, bridge.getLastPlayTime())
        assertFalse(bridge.isCooldownActive())
    }

    @Test
    fun `handlePlayAlarm with unknown type does not update lastPlayTime`() {
        bridge.handlePlayAlarm("unknown_type")
        assertEquals(0L, bridge.getLastPlayTime())
    }

    @Test
    fun `handlePlayAlarm with empty string does not update lastPlayTime`() {
        bridge.handlePlayAlarm("")
        assertEquals(0L, bridge.getLastPlayTime())
    }

    @Test
    fun `handlePlayAlarm with unknown type does not access AudioManager`() {
        bridge.handlePlayAlarm("task_complete")
        verify(mockContext, never()).getSystemService(eq(Context.AUDIO_SERVICE))
    }

    @Test
    fun `handlePlayAlarm skips when sound disabled`() {
        whenever(mockPrefs.getBoolean(eq(Prefs.KEY_SOUND_ENABLED), any())).thenReturn(false)
        bridge.handlePlayAlarm("finished")
        assertEquals(0L, bridge.getLastPlayTime())
    }

    @Test
    fun `handleStopAlarm with null mediaPlayer does not throw`() {
        val mockVibrator: Vibrator = mock()
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val mockVibratorManager: VibratorManager = mock()
            whenever(mockContext.getSystemService(Context.VIBRATOR_MANAGER_SERVICE))
                .thenReturn(mockVibratorManager)
            whenever(mockVibratorManager.defaultVibrator).thenReturn(mockVibrator)
        } else {
            @Suppress("DEPRECATION")
            whenever(mockContext.getSystemService(Context.VIBRATOR_SERVICE))
                .thenReturn(mockVibrator)
        }
        bridge.handleStopAlarm()
        assertEquals(0L, bridge.getLastPlayTime())
    }

    @Test
    fun `handlePlayAlarm with known type accesses AudioManager for ringer check`() {
        val mockAudioManager: AudioManager = mock()
        whenever(mockContext.getSystemService(Context.AUDIO_SERVICE)).thenReturn(mockAudioManager)
        whenever(mockAudioManager.ringerMode).thenReturn(AudioManager.RINGER_MODE_SILENT)

        bridge.handlePlayAlarm("finished")

        verify(mockContext).getSystemService(eq(Context.AUDIO_SERVICE))
    }

    @Test
    fun `handlePlayAlarm in silent mode does not update lastPlayTime`() {
        val mockAudioManager: AudioManager = mock()
        whenever(mockContext.getSystemService(Context.AUDIO_SERVICE)).thenReturn(mockAudioManager)
        whenever(mockAudioManager.ringerMode).thenReturn(AudioManager.RINGER_MODE_SILENT)

        bridge.handlePlayAlarm("finished")

        assertEquals(0L, bridge.getLastPlayTime())
    }

    @Test
    fun `handlePlayAlarm in normal mode updates lastPlayTime`() {
        val mockAudioManager: AudioManager = mock()
        whenever(mockContext.getSystemService(Context.AUDIO_SERVICE)).thenReturn(mockAudioManager)
        whenever(mockAudioManager.ringerMode).thenReturn(AudioManager.RINGER_MODE_NORMAL)

        bridge.handlePlayAlarm("finished")

        assertTrue(bridge.getLastPlayTime() > 0L)
    }

    @Test
    fun `handlePlayAlarm during cooldown skips second call`() {
        val mockAudioManager: AudioManager = mock()
        whenever(mockContext.getSystemService(Context.AUDIO_SERVICE)).thenReturn(mockAudioManager)
        whenever(mockAudioManager.ringerMode).thenReturn(AudioManager.RINGER_MODE_NORMAL)

        bridge.handlePlayAlarm("finished")
        val firstPlayTime = bridge.getLastPlayTime()
        assertTrue(firstPlayTime > 0L)

        bridge.handlePlayAlarm("permission")
        assertEquals(firstPlayTime, bridge.getLastPlayTime())
        assertTrue(bridge.isCooldownActive())
    }

    @Test
    fun `handlePlayAlarm in vibrate mode does not play sound but updates lastPlayTime`() {
        val mockAudioManager: AudioManager = mock()
        whenever(mockContext.getSystemService(Context.AUDIO_SERVICE)).thenReturn(mockAudioManager)
        whenever(mockAudioManager.ringerMode).thenReturn(AudioManager.RINGER_MODE_VIBRATE)

        bridge.handlePlayAlarm("finished")

        assertTrue(bridge.getLastPlayTime() > 0L)
    }

    @Test
    fun `playAlarm posts to handler`() {
        bridge.playAlarm("finished")
        verify(mockHandler).post(any())
    }

    @Test
    fun `stopAlarm posts to handler`() {
        bridge.stopAlarm()
        verify(mockHandler).post(any())
    }
}
