package com.clawd.phone

import java.net.HttpURLConnection
import java.net.MalformedURLException
import java.net.URL

sealed class ConnectionResult {
    data object Success : ConnectionResult()
    data class HttpError(val code: Int) : ConnectionResult()
    data object InvalidUrl : ConnectionResult()
    data object NetworkError : ConnectionResult()
}

object ConnectionChecker {
    const val TIMEOUT_MS = 5000

    fun check(baseUrl: String): ConnectionResult {
        val healthUrl: URL = try {
            URL(baseUrl.trimEnd('/') + "/api/health")
        } catch (e: MalformedURLException) {
            return ConnectionResult.InvalidUrl
        }

        val connection: HttpURLConnection
        return try {
            connection = healthUrl.openConnection() as HttpURLConnection
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.requestMethod = "GET"
            try {
                val code = connection.responseCode
                if (code in 200..299) ConnectionResult.Success
                else ConnectionResult.HttpError(code)
            } catch (e: Exception) {
                ConnectionResult.NetworkError
            } finally {
                connection.disconnect()
            }
        } catch (e: Exception) {
            ConnectionResult.NetworkError
        }
    }
}
