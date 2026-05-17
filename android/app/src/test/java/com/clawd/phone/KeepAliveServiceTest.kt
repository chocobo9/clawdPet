package com.clawd.phone

import android.content.Intent
import org.junit.Assert.assertNull
import org.junit.Test

class KeepAliveServiceTest {

    @Test
    fun `onBind returns null for started service`() {
        val service = KeepAliveService()
        assertNull(service.onBind(Intent()))
    }

    @Test
    fun `onBind returns null with null intent`() {
        val service = KeepAliveService()
        assertNull(service.onBind(null))
    }
}
