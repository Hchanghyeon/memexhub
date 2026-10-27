package io.github.hchanghyeon.memexhub.ui

import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.StringRes
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.runtime.mutableIntStateOf
import io.github.hchanghyeon.memexhub.notes.NotesScreen
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.LocationOn
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.ListItemDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.server.Record

/** Records this app can send. [record] is set once the record is built; the rest say "coming". */
enum class Feature(@StringRes val title: Int, @StringRes val body: Int, val icon: ImageVector, val record: Record? = null) {
    Sms(R.string.feature_sms, R.string.feature_sms_body, Icons.Filled.Email, Record.Sms),
    Pay(R.string.feature_pay, R.string.feature_pay_body, Icons.Filled.Notifications),
    Location(R.string.feature_location, R.string.feature_location_body, Icons.Filled.LocationOn, Record.Location),
    Health(R.string.feature_health, R.string.feature_health_body, Icons.Filled.Favorite),
}

/** From this width the screen shows the list and the selected record side by side (unfolded foldables, tablets). */
private val TwoPaneWidth = 600.dp

@Composable
fun App(vm: AppViewModel = viewModel()) {
    val connection by vm.connection.collectAsState()
    val checking by vm.checking.collectAsState()
    val error by vm.error.collectAsState()
    when (val c = connection) {
        Connection.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        Connection.None -> SetupScreen(checking, error, vm::connect)
        is Connection.Ready -> {
            val on by vm.enabled.collectAsState()
            // The app is in front: a good moment to (re)start location if Android stopped it.
            LaunchedEffect(on[Record.Location]) { if (on[Record.Location] == true) vm.ensureLocation() }
            AskForNotifications()
            LaunchedEffect(Unit) { vm.scheduleNotices() }
            MainTabs(
                notes = { NotesScreen(c.server.url) },
                records = { HomeScreen(c.server.url, on, vm::disconnect) { f, m -> FeatureScreen(f, vm, m) } },
            )
        }
    }
}

/** Notes and Records: a bottom bar on phones and cover screens, a side rail when unfolded or on tablets. */
@Composable
private fun MainTabs(notes: @Composable () -> Unit, records: @Composable () -> Unit) {
    var tab by rememberSaveable { mutableIntStateOf(0) }
    val tabs = listOf(
        Triple(R.string.tab_notes, Icons.AutoMirrored.Filled.List, notes),
        Triple(R.string.tab_records, Icons.AutoMirrored.Filled.Send, records),
    )
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= TwoPaneWidth) {
            Row(Modifier.fillMaxSize()) {
                NavigationRail {
                    tabs.forEachIndexed { i, (label, icon, _) ->
                        NavigationRailItem(selected = tab == i, onClick = { tab = i }, icon = { Icon(icon, null) }, label = { Text(stringResource(label)) })
                    }
                }
                Box(Modifier.weight(1f)) { tabs[tab].third() }
            }
        } else {
            Scaffold(
                bottomBar = {
                    NavigationBar {
                        tabs.forEachIndexed { i, (label, icon, _) ->
                            NavigationBarItem(selected = tab == i, onClick = { tab = i }, icon = { Icon(icon, null) }, label = { Text(stringResource(label)) })
                        }
                    }
                },
            ) { pad -> Box(Modifier.padding(pad).consumeWindowInsets(pad)) { tabs[tab].third() } }
        }
    }
}

/** Notifications are how the app says a record stopped; ask once after connecting. */
@Composable
private fun AskForNotifications() {
    if (Build.VERSION.SDK_INT < 33) return
    var asked by rememberSaveable { mutableStateOf(false) }
    val ask = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
    LaunchedEffect(Unit) {
        if (!asked) {
            asked = true
            ask.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        }
    }
}

@Composable
private fun FeatureScreen(feature: Feature, vm: AppViewModel, modifier: Modifier) {
    val on by vm.enabled.collectAsState()
    val last by vm.last.collectAsState()
    when (val r = feature.record) {
        Record.Sms -> RecordPanel(
            feature, on[r] == true, last[r],
            permissions = listOf(android.Manifest.permission.RECEIVE_SMS),
            privacy = stringResource(R.string.sms_privacy),
            onToggle = { vm.setEnabled(r, it) },
            modifier = modifier,
        )
        Record.Location -> RecordPanel(
            feature, on[r] == true, last[r],
            permissions = listOf(android.Manifest.permission.ACCESS_FINE_LOCATION, android.Manifest.permission.ACCESS_COARSE_LOCATION),
            optional = if (Build.VERSION.SDK_INT >= 33) listOf(android.Manifest.permission.POST_NOTIFICATIONS) else emptyList(),
            privacy = stringResource(R.string.location_privacy),
            onToggle = { vm.setEnabled(r, it) },
            modifier = modifier,
        ) { AlwaysLocation() }
        null -> SoonDetail(feature, modifier)
    }
}

@Composable
fun SetupScreen(checking: Boolean, error: SetupError?, onConnect: (String, String) -> Unit) {
    var url by rememberSaveable { mutableStateOf("") }
    var token by rememberSaveable { mutableStateOf("") }
    Scaffold { pad ->
        Box(Modifier.fillMaxSize().padding(pad).verticalScroll(rememberScrollState()), Alignment.TopCenter) {
            Column(
                Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                Spacer(Modifier.size(24.dp))
                Text(stringResource(R.string.setup_title), style = MaterialTheme.typography.headlineSmall)
                Text(stringResource(R.string.setup_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = url,
                    onValueChange = { url = it },
                    label = { Text(stringResource(R.string.setup_url)) },
                    placeholder = { Text(stringResource(R.string.setup_url_hint)) },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = token,
                    onValueChange = { token = it },
                    label = { Text(stringResource(R.string.setup_token)) },
                    singleLine = true,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                    modifier = Modifier.fillMaxWidth(),
                )
                error?.let {
                    val msg = when (it) {
                        SetupError.HttpsOnly -> R.string.setup_https_only
                        SetupError.Unreachable -> R.string.setup_unreachable
                    }
                    Text(stringResource(msg), color = MaterialTheme.colorScheme.error)
                }
                Button(
                    onClick = { onConnect(url, token) },
                    enabled = !checking && url.isNotBlank() && token.isNotBlank(),
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    Text(stringResource(if (checking) R.string.setup_checking else R.string.setup_connect))
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(
    serverUrl: String,
    on: Map<Record, Boolean>,
    onDisconnect: () -> Unit,
    detail: @Composable (Feature, Modifier) -> Unit,
) {
    // Saved so the selection survives folding and unfolding (the activity is recreated).
    var selected by rememberSaveable { mutableStateOf<Feature?>(null) }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val twoPane = maxWidth >= TwoPaneWidth
        val picked = selected
        if (!twoPane && picked != null) {
            BackHandler { selected = null }
            Scaffold(
                topBar = {
                    TopAppBar(
                        title = { Text(stringResource(picked.title)) },
                        navigationIcon = {
                            IconButton(onClick = { selected = null }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back))
                            }
                        },
                    )
                },
            ) { pad -> detail(picked, Modifier.padding(pad)) }
            return@BoxWithConstraints
        }
        Scaffold(topBar = { TopAppBar(title = { Text(stringResource(R.string.app_name)) }) }) { pad ->
            Row(Modifier.fillMaxSize().padding(pad)) {
                FeatureList(
                    serverUrl = serverUrl,
                    on = on,
                    selected = if (twoPane) selected else null,
                    onSelect = { selected = it },
                    onDisconnect = onDisconnect,
                    modifier = if (twoPane) Modifier.widthIn(max = 360.dp).fillMaxHeight() else Modifier.fillMaxSize(),
                )
                if (twoPane) {
                    VerticalDivider()
                    if (picked != null) {
                        detail(picked, Modifier.weight(1f))
                    } else {
                        Box(Modifier.weight(1f).fillMaxHeight(), Alignment.Center) {
                            Text(stringResource(R.string.home_pick), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FeatureList(
    serverUrl: String,
    on: Map<Record, Boolean>,
    selected: Feature?,
    onSelect: (Feature) -> Unit,
    onDisconnect: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.verticalScroll(rememberScrollState())) {
        ListItem(
            overlineContent = { Text(stringResource(R.string.home_server)) },
            headlineContent = { Text(serverUrl.removePrefix("https://")) },
            supportingContent = { Text(stringResource(R.string.home_connected)) },
            trailingContent = { TextButton(onClick = onDisconnect) { Text(stringResource(R.string.home_disconnect)) } },
        )
        HorizontalDivider()
        Text(
            stringResource(R.string.home_records),
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
        )
        Feature.entries.forEach { f ->
            ListItem(
                leadingContent = { Icon(f.icon, null) },
                headlineContent = { Text(stringResource(f.title)) },
                supportingContent = {
                    val state = when (f.record) {
                        null -> R.string.feature_soon
                        else -> if (on[f.record] == true) R.string.record_on else R.string.record_off
                    }
                    Text(stringResource(state))
                },
                colors = if (f == selected) {
                    ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainer)
                } else {
                    ListItemDefaults.colors()
                },
                modifier = Modifier.clickable { onSelect(f) },
            )
        }
    }
}

@Composable
private fun SoonDetail(feature: Feature, modifier: Modifier = Modifier) {
    Column(
        modifier.fillMaxHeight().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Icon(feature.icon, null, tint = MaterialTheme.colorScheme.primary)
        Text(stringResource(feature.title), style = MaterialTheme.typography.titleLarge)
        Text(stringResource(feature.body))
        Text(stringResource(R.string.feature_soon), color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Preview(name = "Phone · cover screen", widthDp = 360, heightDp = 780)
@Preview(name = "Foldable unfolded", widthDp = 840, heightDp = 780)
@Preview(name = "Tablet landscape", widthDp = 1280, heightDp = 800)
@Composable
private fun HomePreview() {
    MemexhubTheme {
        HomeScreen("https://memexhub.example.com", mapOf(Record.Sms to true), onDisconnect = {}) { f, m -> SoonDetail(f, m) }
    }
}

@Preview(name = "Setup · phone", widthDp = 360, heightDp = 780)
@Preview(name = "Setup · tablet", widthDp = 1280, heightDp = 800)
@Composable
private fun SetupPreview() {
    MemexhubTheme { SetupScreen(checking = false, error = null) { _, _ -> } }
}
