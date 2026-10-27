package io.github.hchanghyeon.memexhub.today

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.hchanghyeon.memexhub.notes.AdminClient
import io.github.hchanghyeon.memexhub.notes.SignedOut
import io.github.hchanghyeon.memexhub.server.Delivery
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.server.Records
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.launch
import java.time.LocalDate

data class Money(val today: Long, val count: Int, val yesterday: Long?, val month: Long)
data class Places(val km: Double, val names: List<String>)
data class RecordState(val record: Record, val on: Boolean, val last: Delivery?)

/** Everything the Today screen shows. null parts are "not loaded" or "not available". */
data class TodayState(
    val date: LocalDate = LocalDate.now(),
    val signedIn: Boolean? = null,
    val loading: Boolean = false,
    val failed: Boolean = false,
    val todos: List<Todo>? = null,
    val todoNote: String? = null,
    val money: Money? = null,
    val places: Places? = null,
    val records: List<RecordState> = emptyList(),
)

class TodayViewModel(app: Application) : AndroidViewModel(app) {
    val state = MutableStateFlow(TodayState())
    private var client: AdminClient? = null
    private val records = Records(app)

    init {
        // This phone's own switches and last sends are known without signing in.
        viewModelScope.launch {
            combine(Record.entries.map { r -> combine(records.enabled(r), records.last(r)) { on, last -> RecordState(r, on, last) } }) { it.toList() }
                .collect { list -> state.value = state.value.copy(records = list) }
        }
    }

    fun bind(serverUrl: String) {
        if (client == null) client = AdminClient(getApplication(), serverUrl)
        refresh()
    }

    fun refresh() {
        val c = client ?: return
        viewModelScope.launch {
            val date = LocalDate.now()
            state.value = state.value.copy(date = date, loading = true, failed = false)
            try {
                if (!c.signedIn()) {
                    state.value = state.value.copy(signedIn = false, loading = false)
                    return@launch
                }
                val todos = async { loadTodos(c, date) }
                val money = async { runCatching { loadMoney(c, date) }.getOrNull() }
                val places = async { runCatching { loadPlaces(c, date) }.getOrNull() }
                val (list, note) = todos.await()
                state.value = state.value.copy(signedIn = true, todos = list, todoNote = note, money = money.await(), places = places.await(), loading = false)
            } catch (e: SignedOut) {
                state.value = state.value.copy(signedIn = false, loading = false)
            } catch (e: Exception) {
                state.value = state.value.copy(loading = false, failed = true)
            }
        }
    }

    private suspend fun loadTodos(c: AdminClient, date: LocalDate): Pair<List<Todo>?, String?> {
        val path = Daily.noteFor(date.toString(), c.files().map { it.path }) ?: return null to null
        return Daily.todos(c.note(path)) to path
    }

    private suspend fun loadMoney(c: AdminClient, date: LocalDate): Money {
        val m = c.money("%d-%02d".format(date.year, date.monthValue))
        val days = m.getJSONArray("days")
        fun total(d: LocalDate): Pair<Long, Int>? = (0 until days.length()).map { days.getJSONObject(it) }
            .firstOrNull { it.getString("date") == d.toString() }?.let { it.getLong("total") to it.getInt("count") }
        val (today, count) = total(date) ?: (0L to 0)
        val yesterday = date.minusDays(1).takeIf { it.monthValue == date.monthValue }?.let { total(it)?.first }
        return Money(today, count, yesterday, m.optLong("total"))
    }

    private suspend fun loadPlaces(c: AdminClient, date: LocalDate): Places? {
        val d = c.locationDay(date.toString())
        if (!d.optBoolean("connected")) return null
        val stays = d.optJSONArray("stays") ?: return Places(d.optDouble("km"), emptyList())
        val names = (0 until stays.length()).map { stays.getJSONObject(it).optString("name") }
            .map { it.ifBlank { "" } }
            .fold(mutableListOf<String>()) { acc, n -> if (acc.lastOrNull() != n) acc += n; acc }
        return Places(d.optDouble("km"), names)
    }
}
