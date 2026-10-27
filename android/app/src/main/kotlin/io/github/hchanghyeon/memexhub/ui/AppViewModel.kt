package io.github.hchanghyeon.memexhub.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.hchanghyeon.memexhub.data.IngestClient
import io.github.hchanghyeon.memexhub.data.Server
import io.github.hchanghyeon.memexhub.data.ServerConfig
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch

sealed interface Connection {
    data object Loading : Connection
    data object None : Connection
    data class Ready(val server: Server) : Connection
}

enum class SetupError { HttpsOnly, Unreachable }

class AppViewModel(app: Application) : AndroidViewModel(app) {
    private val config = ServerConfig(app)

    val connection: StateFlow<Connection> = config.server
        .map { if (it == null) Connection.None else Connection.Ready(it) }
        .stateIn(viewModelScope, SharingStarted.Eagerly, Connection.Loading)

    val checking = MutableStateFlow(false)
    val error = MutableStateFlow<SetupError?>(null)

    fun connect(url: String, token: String) {
        val clean = IngestClient.normalize(url) ?: run { error.value = SetupError.HttpsOnly; return }
        val server = Server(clean, token.trim())
        viewModelScope.launch {
            checking.value = true
            error.value = null
            if (IngestClient(server).reachable()) config.save(server) else error.value = SetupError.Unreachable
            checking.value = false
        }
    }

    fun disconnect() {
        viewModelScope.launch { config.clear() }
    }
}
