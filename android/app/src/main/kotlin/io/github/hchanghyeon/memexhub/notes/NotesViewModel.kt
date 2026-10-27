package io.github.hchanghyeon.memexhub.notes

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

data class Opened(val path: String, val page: WikiText.Page)

class NotesViewModel(app: Application) : AndroidViewModel(app) {
    private var client: AdminClient? = null
    private var url = ""

    /** null while checking. */
    val signedIn = MutableStateFlow<Boolean?>(null)
    val atHome = MutableStateFlow(true)
    val signing = MutableStateFlow(false)
    val signInResult = MutableStateFlow<SignIn?>(null)

    val files = MutableStateFlow<List<VaultFile>>(emptyList())
    val folder = MutableStateFlow("")
    val query = MutableStateFlow("")
    val hits = MutableStateFlow<List<Hit>>(emptyList())
    val opened = MutableStateFlow<Opened?>(null)
    val loading = MutableStateFlow(false)
    val failed = MutableStateFlow(false)
    val missing = MutableStateFlow<String?>(null)
    private val history = ArrayDeque<String>()
    private var searchJob: Job? = null

    fun bind(serverUrl: String) {
        if (serverUrl == url && client != null) return
        url = serverUrl
        client = AdminClient(getApplication(), serverUrl)
        viewModelScope.launch { check() }
    }

    private suspend fun check() {
        val c = client ?: return
        atHome.value = c.atHome()
        val ok = c.signedIn()
        signedIn.value = ok
        if (ok) loadFiles()
    }

    fun signIn(user: String, password: String, code: String) {
        val c = client ?: return
        viewModelScope.launch {
            signing.value = true
            val r = c.signIn(user.trim(), password, code)
            signInResult.value = r
            if (r == SignIn.NeedCode) atHome.value = false
            if (r == SignIn.Ok) {
                signedIn.value = true
                loadFiles()
            }
            signing.value = false
        }
    }

    fun signOut() {
        viewModelScope.launch {
            client?.signOut()
            signedIn.value = false
            files.value = emptyList()
            opened.value = null
            history.clear()
        }
    }

    fun refresh() = viewModelScope.launch { loadFiles() }

    private suspend fun loadFiles() {
        guard { files.value = client!!.files().filter { f -> f.path.split('/').none { it.startsWith(".") } } }
    }

    fun openFolder(path: String) {
        folder.value = path
    }

    fun search(q: String) {
        query.value = q
        searchJob?.cancel()
        if (q.isBlank()) {
            hits.value = emptyList()
            return
        }
        searchJob = viewModelScope.launch {
            delay(300)
            guard { hits.value = client!!.search(q.trim()) }
        }
    }

    fun open(path: String, remember: Boolean = true) {
        viewModelScope.launch {
            missing.value = null
            guard {
                val text = client!!.note(path)
                opened.value?.let { if (remember) history.addLast(it.path) }
                opened.value = Opened(path, WikiText.page(text))
            }
        }
    }

    /** Back inside the notes: the note before a followed link, else close the note. */
    fun back(): Boolean {
        val prev = history.removeLastOrNull()
        if (prev != null) open(prev, remember = false) else if (opened.value != null) opened.value = null else return false
        return true
    }

    fun close() {
        history.clear()
        opened.value = null
    }

    /** A wiki link opens the note it names; returns the URL for anything that should open in the browser. */
    fun follow(dest: String): String? {
        if (!dest.startsWith("wiki:")) return dest
        val target = dest.removePrefix("wiki:")
        val path = WikiText.resolve(target, files.value.map { it.path })
        if (path != null) open(path) else missing.value = target
        return null
    }

    private suspend fun guard(block: suspend () -> Unit) {
        loading.value = true
        failed.value = false
        try {
            block()
        } catch (e: SignedOut) {
            signedIn.value = false
        } catch (e: Exception) {
            failed.value = true
        } finally {
            loading.value = false
        }
    }
}
