package io.github.hchanghyeon.memexhub.server

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.intPreferencesKey
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

/** A kind of record the phone sends. The key names its switch and its last delivery. */
enum class Record(val key: String) { Sms("sms"), Pay("pay"), Location("location") }

/** How finely location is recorded. Auto follows the phone: fine while moving, sparse while still. */
enum class LocationMode(val key: String) { Saver("saver"), Auto("auto"), Detailed("detailed") }

/** How the last send went: when, and the HTTP status (2xx is ok). */
data class Delivery(val at: Long, val code: Int) {
    val ok get() = code in 200..299
}

private val Context.records by preferencesDataStore("records")

/** Per-record switches and the last delivery, shown on each record's screen. */
class Records(context: Context) {
    private val store = context.applicationContext.records

    fun enabled(r: Record): Flow<Boolean> = store.data.map { it[booleanPreferencesKey("${r.key}_on")] ?: false }

    suspend fun isEnabled(r: Record): Boolean = enabled(r).first()

    suspend fun setEnabled(r: Record, on: Boolean) {
        store.edit { it[booleanPreferencesKey("${r.key}_on")] = on }
    }

    fun locationMode(): Flow<LocationMode> = store.data.map { p ->
        LocationMode.entries.firstOrNull { it.key == p[stringPreferencesKey("location_mode")] } ?: LocationMode.Auto
    }

    suspend fun setLocationMode(m: LocationMode) {
        store.edit { it[stringPreferencesKey("location_mode")] = m.key }
    }

    fun last(r: Record): Flow<Delivery?> = store.data.map { p ->
        val at = p[longPreferencesKey("${r.key}_at")] ?: return@map null
        Delivery(at, p[intPreferencesKey("${r.key}_code")] ?: 0)
    }

    suspend fun delivered(r: Record, code: Int, at: Long = System.currentTimeMillis()) {
        store.edit {
            it[longPreferencesKey("${r.key}_at")] = at
            it[intPreferencesKey("${r.key}_code")] = code
        }
    }
}
