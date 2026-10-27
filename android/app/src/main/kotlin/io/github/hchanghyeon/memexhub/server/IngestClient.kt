package io.github.hchanghyeon.memexhub.server

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.HttpURLConnection
import java.net.URI

/** Talks to memexhub's ingest surface. Write-only: it can add records, never read them back. */
class IngestClient(private val server: Server) {

    /** The address answers `/healthz`. */
    suspend fun reachable(): Boolean = withContext(Dispatchers.IO) {
        runCatching {
            val conn = open("/healthz").apply { requestMethod = "GET" }
            try {
                conn.responseCode == 200
            } finally {
                conn.disconnect()
            }
        }.getOrDefault(false)
    }

    /** POSTs a JSON body to an ingest path and returns the HTTP status. */
    suspend fun post(path: String, json: String): Int = withContext(Dispatchers.IO) {
        val conn = open(path).apply {
            requestMethod = "POST"
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("X-Ingest-Token", server.token)
        }
        try {
            conn.outputStream.use { it.write(json.toByteArray()) }
            conn.responseCode
        } finally {
            conn.disconnect()
        }
    }

    private fun open(path: String): HttpURLConnection =
        (URI(server.url.trimEnd('/') + path).toURL().openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
        }

    companion object {
        /** Only https: the token travels in every request. */
        fun normalize(input: String): String? {
            val url = input.trim().trimEnd('/')
            val uri = runCatching { URI(url) }.getOrNull() ?: return null
            return if (uri.scheme == "https" && !uri.host.isNullOrBlank()) url else null
        }
    }
}
