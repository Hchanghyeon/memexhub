package io.github.hchanghyeon.memexhub.server

import android.content.Context
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

/** Where to send records: the ingest address and the device token (stored encrypted). */
data class Server(val url: String, val token: String)

private val Context.store by preferencesDataStore("server")

class ServerConfig(private val context: Context) {
    private val urlKey = stringPreferencesKey("url")
    private val tokenKey = stringPreferencesKey("token_sealed")

    val server: Flow<Server?> = context.store.data.map { p ->
        val url = p[urlKey] ?: return@map null
        val token = p[tokenKey]?.let(TokenCipher::decrypt) ?: return@map null
        Server(url, token)
    }

    suspend fun save(server: Server) {
        context.store.edit {
            it[urlKey] = server.url
            it[tokenKey] = TokenCipher.encrypt(server.token)
        }
    }

    suspend fun clear() {
        context.store.edit { it.clear() }
    }
}
