package io.github.hchanghyeon.memexhub.map

import android.app.Application
import android.graphics.BitmapFactory
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.hchanghyeon.memexhub.notes.AdminClient
import io.github.hchanghyeon.memexhub.notes.SignedOut
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import java.time.LocalDate

data class Stay(val start: Long, val end: Long, val minutes: Int, val lat: Double, val lon: Double, val name: String)

/** One day on the map: the path ([lat, lon] pairs) and where the phone stayed. */
data class MapDay(val date: LocalDate, val km: Double, val path: List<Pair<Double, Double>>, val stays: List<Stay>, val attribution: String?)

data class MapState(
    val date: LocalDate = LocalDate.now(),
    val signedIn: Boolean? = null,
    val loading: Boolean = false,
    val failed: Boolean = false,
    val connected: Boolean = true,
    val day: MapDay? = null,
    val selected: Int? = null,
)

class MapViewModel(app: Application) : AndroidViewModel(app) {
    val state = MutableStateFlow(MapState())
    private var client: AdminClient? = null

    /** Loaded tiles by "z/x/y"; the map redraws as they arrive. */
    val tiles = mutableStateMapOf<String, ImageBitmap>()
    private val asked = HashSet<String>()
    private val gate = Semaphore(4)

    fun bind(serverUrl: String) {
        if (client == null) client = AdminClient(getApplication(), serverUrl)
        load(state.value.date)
    }

    fun previous() = load(state.value.date.minusDays(1))
    fun next() = state.value.date.plusDays(1).takeIf { !it.isAfter(LocalDate.now()) }?.let(::load)
    fun today() = load(LocalDate.now())
    fun select(i: Int?) {
        state.value = state.value.copy(selected = i)
    }

    fun load(date: LocalDate) {
        val c = client ?: return
        viewModelScope.launch {
            state.value = state.value.copy(date = date, loading = true, failed = false, selected = null)
            try {
                val d = c.locationDay(date.toString())
                val path = d.optJSONArray("path")?.let { a -> (0 until a.length()).map { a.getJSONArray(it).let { p -> p.getDouble(0) to p.getDouble(1) } } }.orEmpty()
                val stays = d.optJSONArray("stays")?.let { a ->
                    (0 until a.length()).map { i ->
                        a.getJSONObject(i).let { s -> Stay(s.getLong("start"), s.getLong("end"), s.optInt("minutes"), s.getDouble("lat"), s.getDouble("lon"), s.optString("name")) }
                    }
                }.orEmpty()
                val attribution = d.optJSONObject("tiles")?.optString("attribution")
                state.value = state.value.copy(
                    signedIn = true, loading = false, connected = d.optBoolean("connected"),
                    day = MapDay(date, d.optDouble("km", 0.0), path, stays, attribution),
                )
            } catch (e: SignedOut) {
                state.value = state.value.copy(signedIn = false, loading = false)
            } catch (e: Exception) {
                state.value = state.value.copy(loading = false, failed = true)
            }
        }
    }

    /** Asks for a tile once; it shows up in [tiles] when it arrives. */
    fun need(z: Int, x: Int, y: Int) {
        val key = "$z/$x/$y"
        val c = client ?: return
        if (!asked.add(key)) return
        viewModelScope.launch {
            gate.withPermit {
                val bytes = runCatching { c.tile(z, x, y) }.getOrNull()
                if (bytes == null) {
                    asked.remove(key)
                    return@withPermit
                }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.let { tiles[key] = it.asImageBitmap() }
                // Keep memory bounded: about 120 tiles of 256 px.
                if (tiles.size > 120) tiles.keys.take(tiles.size - 120).forEach { k -> tiles.remove(k); asked.remove(k) }
            }
        }
    }
}
