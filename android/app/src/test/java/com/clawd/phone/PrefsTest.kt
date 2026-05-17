package com.clawd.phone

import org.junit.Assert.assertEquals
import org.junit.Test

class PrefsTest {

    @Test
    fun `prefs name is clawd_prefs`() {
        assertEquals("clawd_prefs", Prefs.NAME)
    }

    @Test
    fun `key server url is server_url`() {
        assertEquals("server_url", Prefs.KEY_SERVER_URL)
    }
}
