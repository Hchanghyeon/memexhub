package io.github.hchanghyeon.memexhub.map

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.ui.kit.CardLabel
import io.github.hchanghyeon.memexhub.ui.kit.Chip
import io.github.hchanghyeon.memexhub.ui.kit.ListRow
import io.github.hchanghyeon.memexhub.ui.kit.MxButton
import io.github.hchanghyeon.memexhub.ui.kit.MxCard
import io.github.hchanghyeon.memexhub.ui.kit.ScreenTitle
import io.github.hchanghyeon.memexhub.ui.kit.pressable
import io.github.hchanghyeon.memexhub.ui.theme.Mx
import io.github.hchanghyeon.memexhub.ui.theme.MxLayout
import io.github.hchanghyeon.memexhub.ui.theme.MxRadius
import io.github.hchanghyeon.memexhub.ui.theme.MxSpace
import io.github.hchanghyeon.memexhub.ui.theme.MxType
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun MapRoute(serverUrl: String, onSignIn: () -> Unit, vm: MapViewModel = viewModel()) {
    LaunchedEffect(serverUrl) { vm.bind(serverUrl) }
    val s by vm.state.collectAsState()
    MapScreen(
        s, tile = { z, x, y -> vm.tiles["$z/$x/$y"] }, need = vm::need,
        onPrevious = vm::previous, onNext = { vm.next() }, onToday = vm::today, onSelect = vm::select, onSignIn = onSignIn,
    )
}

/**
 * Where the day went. Cover screen and phones: the map on top, the stays below.
 * Unfolded: the map on the left, the stays on the right.
 */
@Composable
fun MapScreen(
    s: MapState,
    tile: (Int, Int, Int) -> ImageBitmap? = { _, _, _ -> null },
    need: (Int, Int, Int) -> Unit = { _, _, _ -> },
    onPrevious: () -> Unit = {},
    onNext: () -> Unit = {},
    onToday: () -> Unit = {},
    onSelect: (Int?) -> Unit = {},
    onSignIn: () -> Unit = {},
) {
    BoxWithConstraints(Modifier.fillMaxSize().background(Mx.colors.page)) {
        val wide = maxWidth >= MxLayout.twoPane
        Column(
            Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = MxLayout.gutter, vertical = MxSpace.xs),
            verticalArrangement = Arrangement.spacedBy(MxSpace.s),
        ) {
            ScreenTitle(stringResource(R.string.tab_map))
            DateBar(s, onPrevious, onNext, onToday)
            if (s.signedIn == false) {
                MxCard {
                    Text(stringResource(R.string.map_signin), style = MxType.body, color = Mx.colors.sub)
                    MxButton(stringResource(R.string.signin_button), onSignIn)
                }
                return@Column
            }
            val map: @Composable (Modifier) -> Unit = { m ->
                MapView(s.day, s.selected, tile, need, onSelect, stringResource(R.string.map_fit), m)
            }
            if (wide) {
                Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(MxSpace.s)) {
                    map(Modifier.weight(1.5f).fillMaxSize())
                    Stays(s, onSelect, Modifier.weight(1f).fillMaxSize())
                }
            } else {
                map(Modifier.weight(0.6f).fillMaxWidth())
                Stays(s, onSelect, Modifier.weight(0.4f).fillMaxWidth())
            }
        }
    }
}

@Composable
private fun DateBar(s: MapState, onPrevious: () -> Unit, onNext: () -> Unit, onToday: () -> Unit) {
    val today = LocalDate.now()
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        IconButton(onClick = onPrevious) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, stringResource(R.string.map_previous), tint = Mx.colors.ink) }
        Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
            Text(s.date.format(DateTimeFormatter.ofPattern("M월 d일", Locale.KOREAN)) + " " + s.date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.KOREAN), style = MxType.headline, color = Mx.colors.ink)
            val d = s.day
            Text(
                if (d == null) " " else pluralStringResource(R.plurals.map_summary, d.stays.size, "%.1f".format(d.km), d.stays.size),
                style = MxType.caption, color = Mx.colors.sub,
            )
        }
        if (s.date != today) Chip(stringResource(R.string.tab_today), Modifier.pressable(onToday))
        IconButton(onClick = onNext, enabled = s.date.isBefore(today)) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, stringResource(R.string.map_next), tint = if (s.date.isBefore(today)) Mx.colors.ink else Mx.colors.line)
        }
    }
}

private val hm = DateTimeFormatter.ofPattern("HH:mm")
private fun time(unix: Long) = Instant.ofEpochSecond(unix).atZone(ZoneId.systemDefault()).toLocalTime().format(hm)

@Composable
private fun Stays(s: MapState, onSelect: (Int?) -> Unit, modifier: Modifier) {
    val stays = s.day?.stays.orEmpty()
    Box(modifier.clip(RoundedCornerShape(MxRadius.card)).background(Mx.colors.surface)) {
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = MxSpace.m, vertical = MxSpace.s), verticalArrangement = Arrangement.spacedBy(MxSpace.xxs)) {
            item { CardLabel(stringResource(R.string.map_stays)) }
            if (stays.isEmpty()) {
                item {
                    Text(
                        stringResource(if (s.loading) R.string.map_loading else if (!s.connected) R.string.map_not_connected else R.string.map_none),
                        style = MxType.body, color = Mx.colors.sub, modifier = Modifier.padding(vertical = MxSpace.xs),
                    )
                }
            }
            itemsIndexed(stays) { i, st ->
                Box(Modifier.clip(RoundedCornerShape(MxRadius.control)).background(if (i == s.selected) Mx.colors.accentSoft else Mx.colors.surface).padding(horizontal = MxSpace.xs)) {
                    ListRow(
                        title = st.name.ifBlank { stringResource(R.string.today_place_unnamed) },
                        sub = "${time(st.start)}–${time(st.end)} · " + duration(st.minutes),
                        mark = "${i + 1}",
                        onClick = { onSelect(if (s.selected == i) null else i) },
                    )
                }
            }
        }
    }
}

@Composable
private fun duration(minutes: Int): String =
    if (minutes >= 60) stringResource(R.string.map_hours, minutes / 60, minutes % 60) else stringResource(R.string.map_minutes, minutes)
