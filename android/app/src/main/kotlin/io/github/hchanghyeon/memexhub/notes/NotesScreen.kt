package io.github.hchanghyeon.memexhub.notes

import android.content.Intent
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.core.net.toUri
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.hchanghyeon.memexhub.R

private val TwoPaneWidth = 600.dp

/** The vault, read-only: folders, search, recent notes, and the note itself. Needs the admin sign-in. */
@Composable
fun NotesScreen(serverUrl: String, vm: NotesViewModel = viewModel()) {
    LaunchedEffect(serverUrl) { vm.bind(serverUrl) }
    when (vm.signedIn.collectAsState().value) {
        null -> Box(Modifier.fillMaxSize(), Alignment.Center) { CircularProgressIndicator() }
        false -> SignInForm(vm)
        true -> Browser(vm)
    }
}

@Composable
private fun SignInForm(vm: NotesViewModel) {
    var user by rememberSaveable { mutableStateOf("") }
    var password by rememberSaveable { mutableStateOf("") }
    var code by rememberSaveable { mutableStateOf("") }
    val home by vm.atHome.collectAsState()
    val signing by vm.signing.collectAsState()
    val result by vm.signInResult.collectAsState()
    Box(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), Alignment.TopCenter) {
        Column(Modifier.widthIn(max = 480.dp).fillMaxWidth().padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text(stringResource(R.string.signin_title), style = MaterialTheme.typography.headlineSmall)
            Text(stringResource(R.string.signin_body), color = MaterialTheme.colorScheme.onSurfaceVariant)
            OutlinedTextField(user, { user = it }, label = { Text(stringResource(R.string.signin_user)) }, singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedTextField(
                password, { password = it }, label = { Text(stringResource(R.string.signin_password)) }, singleLine = true,
                visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                modifier = Modifier.fillMaxWidth(),
            )
            if (!home) {
                OutlinedTextField(
                    code, { code = it.filter(Char::isDigit).take(8) }, label = { Text(stringResource(R.string.signin_code)) },
                    supportingText = { Text(stringResource(R.string.signin_code_hint)) }, singleLine = true,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth(),
                )
            }
            val msg = when (result) {
                SignIn.Wrong -> R.string.signin_wrong
                SignIn.NeedCode -> R.string.signin_need_code
                SignIn.HomeOnly -> R.string.signin_home_only
                SignIn.Unreachable -> R.string.signin_unreachable
                else -> null
            }
            msg?.let { Text(stringResource(it), color = MaterialTheme.colorScheme.error) }
            Button(
                onClick = { vm.signIn(user, password, code) },
                enabled = !signing && user.isNotBlank() && password.isNotBlank(),
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.signin_button)) }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Browser(vm: NotesViewModel) {
    val opened by vm.opened.collectAsState()
    val loading by vm.loading.collectAsState()
    val context = LocalContext.current
    val follow: (String) -> Unit = { dest ->
        vm.follow(dest)?.let { url -> runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url.toUri())) } }
    }
    BoxWithConstraints(Modifier.fillMaxSize()) {
        val twoPane = maxWidth >= TwoPaneWidth
        val note = opened
        if (note != null) BackHandler { vm.back() }
        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            if (!twoPane && note != null) note.page.title ?: note.path.substringAfterLast('/').removeSuffix(".md") else stringResource(R.string.tab_notes),
                            maxLines = 1, overflow = TextOverflow.Ellipsis,
                        )
                    },
                    navigationIcon = {
                        if (!twoPane && note != null) {
                            IconButton(onClick = { vm.back() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
                        }
                    },
                    actions = {
                        IconButton(onClick = { vm.refresh() }) { Icon(Icons.Filled.Refresh, stringResource(R.string.notes_refresh)) }
                        TextButton(onClick = { vm.signOut() }) { Text(stringResource(R.string.notes_signout)) }
                    },
                )
            },
        ) { pad ->
            Column(Modifier.fillMaxSize().padding(pad)) {
                if (loading) LinearProgressIndicator(Modifier.fillMaxWidth()) else HorizontalDivider()
                Row(Modifier.fillMaxSize()) {
                    if (twoPane || note == null) {
                        NoteList(vm, if (twoPane) Modifier.widthIn(max = 360.dp).fillMaxHeight() else Modifier.fillMaxSize())
                    }
                    if (twoPane) VerticalDivider()
                    if (note != null) {
                        NoteView(note, vm, follow, Modifier.weight(1f))
                    } else if (twoPane) {
                        Box(Modifier.weight(1f).fillMaxHeight(), Alignment.Center) {
                            Text(stringResource(R.string.notes_pick), color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun NoteList(vm: NotesViewModel, modifier: Modifier) {
    val files by vm.files.collectAsState()
    val folder by vm.folder.collectAsState()
    val query by vm.query.collectAsState()
    val hits by vm.hits.collectAsState()
    val opened by vm.opened.collectAsState()
    val failed by vm.failed.collectAsState()
    val notes = files.filter { it.path.endsWith(".md") }
    // Leaving a sub-folder with back, before leaving the tab.
    BackHandler(enabled = folder.isNotEmpty() && opened == null && query.isBlank()) { vm.openFolder(folder.substringBeforeLast('/', "")) }
    Column(modifier) {
        OutlinedTextField(
            query, vm::search, placeholder = { Text(stringResource(R.string.notes_search)) }, singleLine = true,
            leadingIcon = { Icon(Icons.Filled.Search, null) },
            modifier = Modifier.fillMaxWidth().padding(12.dp),
        )
        if (failed) Text(stringResource(R.string.notes_error), Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        LazyColumn(Modifier.fillMaxSize()) {
            if (query.isNotBlank()) {
                items(hits, key = { "h:" + it.path }) { h ->
                    Row_(h.path, h.lines.firstOrNull(), h.path == opened?.path) { vm.open(h.path) }
                }
                return@LazyColumn
            }
            if (folder.isEmpty()) {
                item { Section(stringResource(R.string.notes_recent)) }
                items(notes.sortedByDescending { it.mtime }.take(8), key = { "r:" + it.path }) { f ->
                    Row_(f.path, f.path.substringBeforeLast('/', "").ifEmpty { null }, f.path == opened?.path) { vm.open(f.path) }
                }
                item { Section(stringResource(R.string.notes_root)) }
            } else {
                item {
                    ListItem(
                        headlineContent = { Text(folder.substringAfterLast('/'), style = MaterialTheme.typography.titleMedium) },
                        supportingContent = { Text(stringResource(R.string.notes_up)) },
                        leadingContent = { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) },
                        modifier = Modifier.clickable { vm.openFolder(folder.substringBeforeLast('/', "")) },
                    )
                }
            }
            val prefix = if (folder.isEmpty()) "" else "$folder/"
            val inside = notes.filter { it.path.startsWith(prefix) }.map { it.path.removePrefix(prefix) }
            val subfolders = inside.filter { '/' in it }.map { it.substringBefore('/') }.distinct().sorted()
            items(subfolders, key = { "d:$prefix$it" }) { d ->
                ListItem(
                    headlineContent = { Text("$d/") },
                    supportingContent = { inside.count { it.startsWith("$d/") }.let { n -> Text(pluralStringResource(R.plurals.notes_count, n, n)) } },
                    modifier = Modifier.clickable { vm.openFolder(prefix + d) },
                )
            }
            items(inside.filter { '/' !in it }.sorted(), key = { "f:$prefix$it" }) { name ->
                Row_(prefix + name, null, prefix + name == opened?.path) { vm.open(prefix + name) }
            }
        }
    }
}

@Composable
private fun Section(title: String) {
    Text(
        title, style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
    )
}

@Composable
private fun Row_(path: String, sub: String?, selected: Boolean, onClick: () -> Unit) {
    ListItem(
        headlineContent = { Text(path.substringAfterLast('/').removeSuffix(".md"), maxLines = 1, overflow = TextOverflow.Ellipsis) },
        supportingContent = sub?.let { { Text(it, maxLines = 1, overflow = TextOverflow.Ellipsis) } },
        colors = if (selected) ListItemDefaults.colors(containerColor = MaterialTheme.colorScheme.surfaceContainer) else ListItemDefaults.colors(),
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
private fun NoteView(note: Opened, vm: NotesViewModel, onLink: (String) -> Unit, modifier: Modifier) {
    val missing by vm.missing.collectAsState()
    Column(modifier.fillMaxHeight().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(note.page.title ?: note.path.substringAfterLast('/').removeSuffix(".md"), style = MaterialTheme.typography.headlineSmall)
        val meta = listOfNotNull(note.path.substringBeforeLast('/', "").ifEmpty { null }, note.page.updated, note.page.tags).joinToString(" · ")
        if (meta.isNotEmpty()) Text(meta, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        missing?.let { Text(stringResource(R.string.notes_missing, it), color = MaterialTheme.colorScheme.error) }
        HorizontalDivider(Modifier.padding(vertical = 4.dp))
        Markdown(note.page.body, onLink, Modifier.fillMaxWidth())
        Box(Modifier.size(32.dp))
    }
}
