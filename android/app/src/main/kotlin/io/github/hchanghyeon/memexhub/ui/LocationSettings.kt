package io.github.hchanghyeon.memexhub.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.os.PowerManager
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.compose.LifecycleResumeEffect
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.server.LocationMode
import io.github.hchanghyeon.memexhub.ui.kit.MxButton
import io.github.hchanghyeon.memexhub.ui.kit.pressable
import io.github.hchanghyeon.memexhub.ui.theme.Mx
import io.github.hchanghyeon.memexhub.ui.theme.MxRadius
import io.github.hchanghyeon.memexhub.ui.theme.MxSpace
import io.github.hchanghyeon.memexhub.ui.theme.MxType

/** Pick how finely location is recorded: three cards, the chosen one outlined in the brand color. */
@Composable
fun LocationModePicker(mode: LocationMode, onMode: (LocationMode) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(MxSpace.xs)) {
        Text(stringResource(R.string.location_mode), style = MxType.headline, color = Mx.colors.ink)
        // Recommended first.
        listOf(LocationMode.Auto, LocationMode.Detailed, LocationMode.Saver).forEach { m ->
            val on = m == mode
            Column(
                Modifier.fillMaxWidth()
                    .pressable({ onMode(m) }, Role.RadioButton)
                    .clip(RoundedCornerShape(MxRadius.control))
                    .background(if (on) Mx.colors.accentSoft else Mx.colors.sunken)
                    .border(if (on) 2.dp else 0.dp, if (on) Mx.colors.accent else Mx.colors.sunken, RoundedCornerShape(MxRadius.control))
                    .padding(MxSpace.m),
                verticalArrangement = Arrangement.spacedBy(MxSpace.xxs),
            ) {
                Text(stringResource(modeTitle(m)), style = MxType.label, color = if (on) Mx.colors.accent else Mx.colors.ink)
                Text(stringResource(modeBody(m)), style = MxType.caption, color = Mx.colors.sub)
            }
        }
    }
}

private fun modeTitle(m: LocationMode) = when (m) {
    LocationMode.Auto -> R.string.location_mode_auto
    LocationMode.Detailed -> R.string.location_mode_detailed
    LocationMode.Saver -> R.string.location_mode_saver
}

private fun modeBody(m: LocationMode) = when (m) {
    LocationMode.Auto -> R.string.location_mode_auto_body
    LocationMode.Detailed -> R.string.location_mode_detailed_body
    LocationMode.Saver -> R.string.location_mode_saver_body
}

/**
 * Battery optimization stops location overnight on many phones (Galaxy puts unused apps to sleep).
 * Shown until the app is exempt; the Galaxy line names One UI's own list.
 */
@SuppressLint("BatteryLife") // installed outside Play; the user asks for exact, all-day location
@Composable
fun KeepAwake() {
    val ctx = LocalContext.current
    var tick by remember { mutableIntStateOf(0) }
    LifecycleResumeEffect(Unit) {
        tick++
        onPauseOrDispose {}
    }
    val exempt = remember(tick) { ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName) }
    if (exempt) return
    Column(verticalArrangement = Arrangement.spacedBy(MxSpace.xs)) {
        Text(stringResource(R.string.location_battery_title), style = MxType.headline, color = Mx.colors.ink)
        Text(stringResource(R.string.location_battery_body), style = MxType.body, color = Mx.colors.sub)
        MxButton(stringResource(R.string.location_battery_button), onClick = {
            runCatching { ctx.startActivity(Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, "package:${ctx.packageName}".toUri())) }
        })
        Text(stringResource(R.string.location_battery_galaxy), style = MxType.caption, color = Mx.colors.sub)
    }
}
