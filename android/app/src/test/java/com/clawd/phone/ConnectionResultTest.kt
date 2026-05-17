package com.clawd.phone

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConnectionResultTest {

    @Test
    fun `Success is singleton`() {
        assertTrue(ConnectionResult.Success === ConnectionResult.Success)
    }

    @Test
    fun `InvalidUrl is singleton`() {
        assertTrue(ConnectionResult.InvalidUrl === ConnectionResult.InvalidUrl)
    }

    @Test
    fun `NetworkError is singleton`() {
        assertTrue(ConnectionResult.NetworkError === ConnectionResult.NetworkError)
    }

    @Test
    fun `HttpError carries status code`() {
        val error = ConnectionResult.HttpError(404)
        assertEquals(404, error.code)
    }

    @Test
    fun `HttpError equals with same code`() {
        assertEquals(ConnectionResult.HttpError(500), ConnectionResult.HttpError(500))
    }

    @Test
    fun `HttpError not equal with different code`() {
        assertNotEquals(ConnectionResult.HttpError(404), ConnectionResult.HttpError(500))
    }

    @Test
    fun `sealed type exhaustive when`() {
        val results = listOf(
            ConnectionResult.Success,
            ConnectionResult.InvalidUrl,
            ConnectionResult.NetworkError,
            ConnectionResult.HttpError(503)
        )
        for (result in results) {
            val label = when (result) {
                is ConnectionResult.Success -> "ok"
                is ConnectionResult.InvalidUrl -> "bad_url"
                is ConnectionResult.NetworkError -> "net_err"
                is ConnectionResult.HttpError -> "http_${result.code}"
            }
            assertTrue(label.isNotBlank())
        }
    }
}
