package io.github.hchanghyeon.memexhub.notes

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import io.github.hchanghyeon.memexhub.server.TokenCipher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URI
import java.net.URLEncoder

data class VaultFile(val path: String, val mtime: String)
data class Hit(val path: String, val lines: List<String>)

sealed interface SignIn {
    data object Ok : SignIn
    data object Wrong : SignIn
    /** Outside the home network: the authenticator code is needed (or was wrong). */
    data object NeedCode : SignIn
    /** The server only opens the admin app on its private network. */
    data object HomeOnly : SignIn
    data object Unreachable : SignIn
}

class SignedOut : Exception("signed_out")

private val Context.admin by preferencesDataStore("admin")

/**
 * Reads the vault through the admin app's JSON API, signed in as the admin. The device token is
 * never used here: it stays send-only. Cookies (session, remembered device) are kept encrypted.
 */
class AdminClient(context: Context, base: String) {
    private val store = context.applicationContext.admin
    private val api = base.trimEnd('/') + "/admin/api"
    private val cookieKey = stringPreferencesKey("cookies")

    suspend fun signedIn(): Boolean = runCatching { JSONObject(get("/session")).optBoolean("signedIn") }.getOrDefault(false)

    /** Whether the server sees this phone on its home network (no code needed there). */
    suspend fun atHome(): Boolean = runCatching { JSONObject(get("/session", allowSignedOut = true)).optBoolean("home") }.getOrDefault(false)

    suspend fun signIn(username: String, password: String, code: String): SignIn = withContext(Dispatchers.IO) {
        val body = JSONObject().put("username", username).put("password", password).put("remember", true)
        if (code.isNotBlank()) body.put("totp", code.trim())
        val conn = runCatching { open("/login", "POST", cookies()) }.getOrElse { return@withContext SignIn.Unreachable }
        try {
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val status = conn.responseCode
            val text = (if (status < 400) conn.inputStream else conn.errorStream)?.bufferedReader()?.use { it.readText() }.orEmpty()
            when {
                status == 200 -> {
                    keep(conn)
                    SignIn.Ok
                }
                status == 403 && text.contains("two_factor") -> SignIn.NeedCode
                status == 403 -> SignIn.HomeOnly
                status == 401 -> if (code.isBlank() && !atHome()) SignIn.NeedCode else SignIn.Wrong
                else -> SignIn.Unreachable
            }
        } catch (e: Exception) {
            SignIn.Unreachable
        } finally {
            conn.disconnect()
        }
    }

    suspend fun signOut() {
        runCatching {
            val csrf = JSONObject(get("/session")).optString("csrf")
            withContext(Dispatchers.IO) {
                val conn = open("/logout", "POST", cookies()).apply { setRequestProperty("X-CSRF", csrf) }
                try { conn.responseCode } finally { conn.disconnect() }
            }
        }
        // Keep the remembered-device cookie so the next sign-in outside does not ask for a code.
        store.edit { p -> p[cookieKey] = TokenCipher.encrypt(jar().filterKeys { it == TRUST }.encode()) }
    }

    suspend fun files(): List<VaultFile> {
        val list = JSONObject(get("/vault/files")).getJSONArray("files")
        return (0 until list.length()).map { list.getJSONObject(it).let { f -> VaultFile(f.getString("path"), f.optString("mtime")) } }
    }

    suspend fun note(path: String): String = JSONObject(get("/vault/note?path=" + enc(path))).getString("text")

    suspend fun search(q: String): List<Hit> {
        val hits = JSONObject(get("/vault/search?q=" + enc(q))).getJSONArray("hits")
        return (0 until hits.length()).map { i ->
            val h = hits.getJSONObject(i)
            val lines = h.optJSONArray("lines")
            Hit(h.getString("path"), (0 until (lines?.length() ?: 0)).map { lines!!.getJSONObject(it).optString("text") })
        }
    }

    /** Who is signed in, whether two-factor is on, and whether the server sees this phone at home. */
    data class Account(val username: String, val totp: Boolean, val home: Boolean)

    suspend fun account(): Account {
        val s = JSONObject(get("/session"))
        if (!s.optBoolean("signedIn")) throw SignedOut()
        return Account(s.optString("username"), s.optBoolean("totp"), s.optBoolean("home"))
    }

    /** POSTs a change with the session's CSRF token. Returns the server's error code, or null when it worked. */
    suspend fun change(path: String, body: JSONObject = JSONObject()): String? {
        val csrf = JSONObject(get("/session")).optString("csrf")
        return withContext(Dispatchers.IO) {
            val conn = open(path, "POST", cookies()).apply {
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-CSRF", csrf)
                doOutput = true
            }
            try {
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
                val status = conn.responseCode
                keep(conn)
                if (status == 401) throw SignedOut()
                if (status in 200..299) return@withContext null
                val text = conn.errorStream?.bufferedReader()?.use { it.readText() }.orEmpty()
                runCatching { JSONObject(text).optString("error") }.getOrNull()?.ifBlank { null } ?: "http_$status"
            } finally {
                conn.disconnect()
            }
        }
    }

    /** Starts (or moves) two-factor; returns the new key, or the error code. */
    suspend fun startTotp(code: String?): Pair<String?, String?> {
        val csrf = JSONObject(get("/session")).optString("csrf")
        return withContext(Dispatchers.IO) {
            val conn = open("/totp/start", "POST", cookies()).apply {
                setRequestProperty("Content-Type", "application/json")
                setRequestProperty("X-CSRF", csrf)
                doOutput = true
            }
            try {
                conn.outputStream.use { it.write((if (code.isNullOrBlank()) JSONObject() else JSONObject().put("code", code.trim())).toString().toByteArray()) }
                val status = conn.responseCode
                if (status == 401) throw SignedOut()
                if (status in 200..299) JSONObject(conn.inputStream.bufferedReader().use { it.readText() }).optString("secret") to null
                else null to runCatching { JSONObject(conn.errorStream.bufferedReader().use { it.readText() }).optString("error") }.getOrDefault("http_$status")
            } finally {
                conn.disconnect()
            }
        }
    }

    /** The month's money report (`/money`): days with totals, the month total. */
    suspend fun money(month: String): JSONObject = JSONObject(get("/money?month=$month"))

    /** One map tile (PNG) through the server's cache, or null when there is none. */
    suspend fun tile(z: Int, x: Int, y: Int): ByteArray? = withContext(Dispatchers.IO) {
        val conn = open("/map/tile/$z/$x/$y", "GET", cookies())
        try {
            if (conn.responseCode == 200) conn.inputStream.use { it.readBytes() } else null
        } finally {
            conn.disconnect()
        }
    }

    /** One day of places (`/location/day`): distance and stays with names. */
    suspend fun locationDay(date: String): JSONObject = JSONObject(get("/location/day?date=$date"))

    private suspend fun get(path: String, allowSignedOut: Boolean = false): String = withContext(Dispatchers.IO) {
        val conn = open(path, "GET", cookies())
        try {
            val status = conn.responseCode
            if (status == 401 || (status == 403 && !allowSignedOut)) throw SignedOut()
            if (status !in 200..299) error("http $status")
            conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun open(path: String, method: String, cookie: String): HttpURLConnection =
        (URI(api + path).toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = method
            instanceFollowRedirects = false
            connectTimeout = 10_000
            readTimeout = 20_000
            if (cookie.isNotEmpty()) setRequestProperty("Cookie", cookie)
        }

    private suspend fun jar(): Map<String, String> =
        store.data.first()[cookieKey]?.let(TokenCipher::decrypt)?.decode() ?: emptyMap()

    private suspend fun cookies() = jar().entries.joinToString("; ") { "${it.key}=${it.value}" }

    /** Keeps the session and remembered-device cookies the server set. */
    private suspend fun keep(conn: HttpURLConnection) {
        val got = (conn.headerFields["Set-Cookie"] ?: conn.headerFields["set-cookie"]).orEmpty()
            .mapNotNull { h -> h.substringBefore(';').split('=', limit = 2).takeIf { it.size == 2 } }
            .filter { it[0] == SESSION || it[0] == TRUST }
            .associate { it[0] to it[1] }
        if (got.isEmpty()) return
        // A cookie set to an empty value is the server deleting it.
        val next = (jar() + got).filterValues { it.isNotEmpty() }
        store.edit { it[cookieKey] = TokenCipher.encrypt(next.encode()) }
    }

    private companion object {
        const val SESSION = "mx_admin"
        const val TRUST = "mx_trust"
        fun enc(s: String): String = URLEncoder.encode(s, "UTF-8").replace("+", "%20")
        fun Map<String, String>.encode() = JSONObject(this).toString()
        fun String.decode(): Map<String, String> = JSONObject(this).let { o -> o.keys().asSequence().associateWith { o.getString(it) } }
    }
}
