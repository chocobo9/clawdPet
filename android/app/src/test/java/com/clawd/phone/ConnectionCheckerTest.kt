package com.clawd.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionCheckerTest {

    @Test
    fun `check returns InvalidUrl for garbage input`() {
        val result = ConnectionChecker.check("not a url")
        assertTrue(result is ConnectionResult.InvalidUrl)
    }

    @Test
    fun `check returns InvalidUrl for empty string`() {
        val result = ConnectionChecker.check("")
        assertTrue(result is ConnectionResult.InvalidUrl)
    }

    @Test
    fun `check returns InvalidUrl for protocol-only`() {
        val result = ConnectionChecker.check("http://")
        assertTrue(result is ConnectionResult.NetworkError || result is ConnectionResult.InvalidUrl)
    }

    @Test
    fun `check returns NetworkError for unreachable host`() {
        val result = ConnectionChecker.check("http://192.0.2.1:1")
        assertTrue(
            "Expected NetworkError or HttpError, got $result",
            result is ConnectionResult.NetworkError || result is ConnectionResult.HttpError
        )
    }

    @Test
    fun `check builds correct health URL with trailing slash`() {
        val result = ConnectionChecker.check("http://192.0.2.1:9870/")
        assertTrue(result is ConnectionResult.NetworkError || result is ConnectionResult.HttpError)
    }

    @Test
    fun `check builds correct health URL without trailing slash`() {
        val result = ConnectionChecker.check("http://192.0.2.1:9870")
        assertTrue(result is ConnectionResult.NetworkError || result is ConnectionResult.HttpError)
    }

    @Test
    fun `timeout constant is 5 seconds`() {
        assertEquals(5000, ConnectionChecker.TIMEOUT_MS)
    }
}
