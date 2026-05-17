package com.clawd.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityTest {

    @Test
    fun `isLongPress returns false for 0ms hold`() {
        assertFalse(MainActivity.isLongPress(0L))
    }

    @Test
    fun `isLongPress returns false for 799ms hold`() {
        assertFalse(MainActivity.isLongPress(799L))
    }

    @Test
    fun `isLongPress returns true at exactly 800ms`() {
        assertTrue(MainActivity.isLongPress(800L))
    }

    @Test
    fun `isLongPress returns true for 1500ms hold`() {
        assertTrue(MainActivity.isLongPress(1500L))
    }

    @Test
    fun `isLongPress returns false for negative duration`() {
        assertFalse(MainActivity.isLongPress(-1L))
    }

    @Test
    fun `threshold constant is 800ms`() {
        assertEquals(800L, MainActivity.LONG_PRESS_THRESHOLD_MS)
    }
}
