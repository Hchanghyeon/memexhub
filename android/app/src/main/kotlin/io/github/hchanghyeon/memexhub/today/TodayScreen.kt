package io.github.hchanghyeon.memexhub.today

import android.text.format.DateUtils
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.ui.kit.BigNumber
import io.github.hchanghyeon.memexhub.ui.kit.CardLabel
import io.github.hchanghyeon.memexhub.ui.kit.Chip
import io.github.hchanghyeon.memexhub.ui.kit.Delta
import io.github.hchanghyeon.memexhub.ui.kit.Health
import io.github.hchanghyeon.memexhub.ui.kit.MxButton
import io.github.hchanghyeon.memexhub.ui.kit.MxCard
import io.github.hchanghyeon.memexhub.ui.kit.Progress
import io.github.hchanghyeon.memexhub.ui.kit.ScreenTitle
import io.github.hchanghyeon.memexhub.ui.kit.StatusDot
import io.github.hchanghyeon.memexhub.ui.kit.TodoRow
import io.github.hchanghyeon.memexhub.ui.theme.Mx
import io.github.hchanghyeon.memexhub.ui.theme.MxLayout
import io.github.hchanghyeon.memexhub.ui.theme.MxSpace
import io.github.hchanghyeon.memexhub.ui.theme.MxType
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale
import kotlin.math.abs

@Composable
fun TodayRoute(serverUrl: String, onSignIn: () -> Unit, onOpen: (String) -> Unit, onOpenNote: (String) -> Unit, vm: TodayViewModel = viewModel()) {
    LaunchedEffect(serverUrl) { vm.bind(serverUrl) }
    val state by vm.state.collectAsState()
    TodayScreen(state, onRefresh = vm::refresh, onSignIn = onSignIn, onOpen = onOpen, onOpenNote = onOpenNote)
}

/**
 * The first screen: today's to-dos, money, places and whether this phone's records are flowing.
 * Cover screen and phones: one column. Unfolded (≥ twoPane): to-dos and status left, money and places right.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TodayScreen(
    state: TodayState,
    onRefresh: () -> Unit = {},
    onSignIn: () -> Unit = {},
    onOpen: (String) -> Unit = {},
    onOpenNote: (String) -> Unit = {},
) {
    PullToRefreshBox(isRefreshing = state.loading, onRefresh = onRefresh, modifier = Modifier.fillMaxSize().background(Mx.colors.page)) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            val wide = maxWidth >= MxLayout.twoPane
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).statusBarsPadding()
                    .padding(horizontal = MxLayout.gutter, vertical = MxSpace.xs),
                verticalArrangement = Arrangement.spacedBy(MxSpace.s),
            ) {
                ScreenTitle(stringResource(R.string.tab_today), aside = dateLine(state))
                if (state.signedIn == false) {
                    SignInCard(onSignIn)
                    RecordsCard(state)
                } else if (wide) {
                    Row(horizontalArrangement = Arrangement.spacedBy(MxSpace.s)) {
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(MxSpace.s)) {
                            TodoCard(state, onOpenNote)
                            RecordsCard(state)
                        }
                        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(MxSpace.s)) {
                            MoneyCard(state, onOpen)
                            PlacesCard(state)
                        }
                    }
                } else {
                    TodoCard(state, onOpenNote)
                    MoneyCard(state, onOpen)
                    PlacesCard(state)
                    RecordsCard(state)
                }
                if (state.failed) Text(stringResource(R.string.today_failed), style = MxType.caption, color = Mx.colors.danger)
            }
        }
    }
}

private fun dateLine(s: TodayState): String {
    val d = s.date
    return d.format(DateTimeFormatter.ofPattern("M월 d일", Locale.KOREAN)) + " " + d.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.KOREAN)
}

private val won = NumberFormat.getIntegerInstance(Locale.KOREA)

@Composable
private fun TodoCard(s: TodayState, onOpenNote: (String) -> Unit) {
    val todos = s.todos
    MxCard(onClick = s.todoNote?.let { { onOpenNote(it) } }) {
        if (todos.isNullOrEmpty()) {
            CardLabel(stringResource(R.string.today_todo))
            Text(
                stringResource(if (todos == null) R.string.today_todo_no_note else R.string.today_todo_none),
                style = MxType.body, color = Mx.colors.sub,
            )
            return@MxCard
        }
        val done = todos.count { it.done }
        CardLabel(stringResource(R.string.today_todo)) { BigNumber(done.toLong(), of = todos.size.toLong()) }
        Progress(done.toFloat() / todos.size)
        Column(verticalArrangement = Arrangement.spacedBy(MxSpace.s), modifier = Modifier.padding(top = MxSpace.xxs)) {
            // Open ones first: what is left matters more than what is done.
            todos.sortedBy { it.done }.take(6).forEach { TodoRow(it.text, it.done, it.badge) }
            if (todos.size > 6) Text(pluralStringResource(R.plurals.today_more, todos.size - 6, todos.size - 6), style = MxType.caption, color = Mx.colors.sub)
        }
    }
}

@Composable
private fun MoneyCard(s: TodayState, onOpen: (String) -> Unit) {
    val m = s.money ?: return
    MxCard {
        CardLabel(stringResource(R.string.today_money))
        BigNumber(m.today, unit = stringResource(R.string.won))
        val count = pluralStringResource(R.plurals.today_payments, m.count, m.count)
        val y = m.yesterday
        if (y == null) {
            Delta(count)
        } else {
            val diff = won.format(abs(m.today - y)) + stringResource(R.string.won)
            val strong = stringResource(if (m.today <= y) R.string.today_less else R.string.today_more_spent, diff)
            Delta(stringResource(R.string.today_vs_yesterday, count, strong), strong)
        }
        Text(stringResource(R.string.today_month, won.format(m.month)), style = MxType.caption, color = Mx.colors.sub)
        MxButton(stringResource(R.string.today_money_open), onClick = { onOpen("/admin/money") }, soft = true)
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun PlacesCard(s: TodayState) {
    val p = s.places ?: return
    MxCard {
        CardLabel(stringResource(R.string.today_places, "%.1f".format(p.km)))
        if (p.names.isEmpty()) {
            Text(stringResource(R.string.today_places_none), style = MxType.body, color = Mx.colors.sub)
        } else {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(MxSpace.xs), verticalArrangement = Arrangement.spacedBy(MxSpace.xs), itemVerticalAlignment = Alignment.CenterVertically) {
                p.names.takeLast(7).forEachIndexed { i, n ->
                    if (i > 0) Text("→", style = MxType.body, color = Mx.colors.sub)
                    if (n.isBlank()) Chip(stringResource(R.string.today_place_unnamed)) else Text(n, style = MxType.headline, color = Mx.colors.ink)
                }
            }
        }
    }
}

@Composable
private fun RecordsCard(s: TodayState) {
    if (s.records.isEmpty()) return
    MxCard {
        CardLabel(stringResource(R.string.today_records))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(MxSpace.s)) {
            s.records.forEach { r ->
                val name = stringResource(when (r.record) { Record.Sms -> R.string.feature_sms; Record.Pay -> R.string.feature_pay; Record.Location -> R.string.feature_location })
                val last = r.last
                val (health, sub) = when {
                    !r.on -> Health.Off to stringResource(R.string.record_off)
                    last == null -> Health.Ok to stringResource(R.string.today_waiting)
                    !last.ok -> Health.Warn to stringResource(R.string.today_failed_code, last.code)
                    else -> Health.Ok to DateUtils.getRelativeTimeSpanString(last.at, System.currentTimeMillis(), DateUtils.MINUTE_IN_MILLIS).toString()
                }
                StatusDot(name, sub, health, Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun SignInCard(onSignIn: () -> Unit) {
    MxCard {
        Text(stringResource(R.string.today_signin_title), style = MxType.headline, color = Mx.colors.ink)
        Text(stringResource(R.string.today_signin_body), style = MxType.body, color = Mx.colors.sub)
        MxButton(stringResource(R.string.signin_button), onClick = onSignIn)
    }
}
