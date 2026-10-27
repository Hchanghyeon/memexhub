package io.github.hchanghyeon.memexhub.account

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import io.github.hchanghyeon.memexhub.notes.AdminClient
import io.github.hchanghyeon.memexhub.notes.SignedOut
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

/** What the account screen shows. [notice] is a result line: a server error code, or "ok:<what>". */
data class AccountState(
    val account: AdminClient.Account? = null,
    val signedIn: Boolean? = null,
    val busy: Boolean = false,
    val notice: String? = null,
    /** A new authenticator key waiting for its first code. */
    val newKey: String? = null,
)

class AccountViewModel(app: Application) : AndroidViewModel(app) {
    val state = MutableStateFlow(AccountState())
    private var client: AdminClient? = null

    fun bind(serverUrl: String) {
        if (client == null) client = AdminClient(getApplication(), serverUrl)
        load()
    }

    fun load() = run(null) { state.value = state.value.copy(account = it.account(), signedIn = true) }

    fun changePassword(current: String, next: String) = run("ok:password") { it.change("/password", JSONObject().put("current", current).put("next", next)) }

    fun startKey(code: String?) = run(null) {
        val (key, error) = it.startTotp(code)
        state.value = state.value.copy(newKey = key)
        error
    }

    fun confirmKey(code: String) = run("ok:totp") {
        it.change("/totp/confirm", JSONObject().put("code", code.trim())).also { e ->
            if (e == null) state.value = state.value.copy(newKey = null, account = it.account())
        }
    }

    fun cancelKey() {
        state.value = state.value.copy(newKey = null, notice = null)
    }

    fun turnOff(password: String) = run("ok:off") {
        it.change("/totp/disable", JSONObject().put("password", password)).also { e -> if (e == null) state.value = state.value.copy(account = it.account()) }
    }

    fun forgetDevices() = run("ok:devices") { it.change("/forget-devices") }

    fun signOut(onDone: () -> Unit) {
        viewModelScope.launch {
            client?.signOut()
            state.value = AccountState(signedIn = false)
            onDone()
        }
    }

    /** Runs a call; a null result is success and shows [ok], a string is the server's error code. */
    private fun run(ok: String?, block: suspend (AdminClient) -> Any?) {
        val c = client ?: return
        viewModelScope.launch {
            state.value = state.value.copy(busy = true, notice = null)
            val notice = try {
                when (val r = block(c)) {
                    is String -> r
                    else -> ok
                }
            } catch (e: SignedOut) {
                state.value = state.value.copy(signedIn = false)
                null
            } catch (e: Exception) {
                "unreachable"
            }
            state.value = state.value.copy(busy = false, notice = notice)
        }
    }
}
