package io.github.hchanghyeon.memexhub.ui

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.text.format.DateUtils
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.server.Delivery

/**
 * One record's screen: a switch, what is sent, and how the last send went. Turning it on asks for
 * [permissions] first; the switch only stays on once they are granted.
 */
@Composable
fun RecordPanel(
    feature: Feature,
    on: Boolean,
    last: Delivery?,
    permissions: List<String>,
    privacy: String,
    onToggle: (Boolean) -> Unit,
    modifier: Modifier = Modifier,
    optional: List<String> = emptyList(),
    extra: @Composable () -> Unit = {},
) {
    val context = LocalContext.current
    var denied by rememberSaveable { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val ok = permissions.all { result[it] ?: context.granted(it) }
        denied = !ok
        if (ok) onToggle(true)
    }
    // Permissions can be taken away in system settings while the switch is on.
    val missing = permissions.filterNot { context.granted(it) }
    Column(
        modifier.fillMaxHeight().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(feature.icon, null, tint = MaterialTheme.colorScheme.primary)
        Text(stringResource(feature.title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(feature.body))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text(stringResource(R.string.record_send), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
            Switch(
                checked = on && missing.isEmpty(),
                onCheckedChange = { want ->
                    when {
                        !want -> onToggle(false)
                        missing.isEmpty() -> onToggle(true)
                        else -> ask.launch((missing + optional.filterNot { context.granted(it) }).toTypedArray())
                    }
                },
            )
        }
        if (denied || (on && missing.isNotEmpty())) {
            Text(stringResource(R.string.record_permission), color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { context.openAppInfo() }) { Text(stringResource(R.string.record_app_info)) }
        }
        if (on && missing.isEmpty()) extra()
        Text(lastLine(context, last), color = if (last != null && !last.ok) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
        Text(privacy, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/** Second step for location: "all the time", so it can restart after a reboot or an update. */
@Composable
fun AlwaysLocation() {
    if (android.os.Build.VERSION.SDK_INT < 29) return
    val context = LocalContext.current
    var granted by remember { mutableStateOf(context.granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION)) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    if (granted) return
    Text(stringResource(R.string.location_always), color = MaterialTheme.colorScheme.onSurfaceVariant)
    OutlinedButton(onClick = { ask.launch(Manifest.permission.ACCESS_BACKGROUND_LOCATION) }) {
        Text(stringResource(R.string.location_always_button))
    }
}

private fun lastLine(context: Context, last: Delivery?): String {
    if (last == null) return context.getString(R.string.record_never)
    val time = DateUtils.formatDateTime(context, last.at, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_ABBREV_MONTH)
    return if (last.ok) context.getString(R.string.record_last_ok, time) else context.getString(R.string.record_last_failed, time, last.code)
}

private fun Context.granted(permission: String) =
    ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

private fun Context.openAppInfo() {
    startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
}
