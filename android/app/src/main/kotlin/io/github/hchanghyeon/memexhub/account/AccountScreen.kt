package io.github.hchanghyeon.memexhub.account

import android.content.ClipData
import android.content.Intent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import io.github.hchanghyeon.memexhub.ui.theme.MxRadius
import androidx.compose.ui.platform.ClipEntry
import androidx.compose.ui.platform.LocalClipboard
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.core.net.toUri
import androidx.lifecycle.viewmodel.compose.viewModel
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.ui.kit.CardLabel
import io.github.hchanghyeon.memexhub.ui.kit.Chip
import io.github.hchanghyeon.memexhub.ui.kit.Health
import io.github.hchanghyeon.memexhub.ui.kit.MxButton
import io.github.hchanghyeon.memexhub.ui.kit.MxCard
import io.github.hchanghyeon.memexhub.ui.kit.StatusDot
import io.github.hchanghyeon.memexhub.ui.theme.Mx
import io.github.hchanghyeon.memexhub.ui.theme.MxLayout
import io.github.hchanghyeon.memexhub.ui.theme.MxSpace
import io.github.hchanghyeon.memexhub.ui.theme.MxType
import kotlinx.coroutines.launch

@Composable
fun AccountRoute(serverUrl: String, onSignIn: () -> Unit, modifier: Modifier = Modifier, vm: AccountViewModel = viewModel()) {
    LaunchedEffect(serverUrl) { vm.bind(serverUrl) }
    val s by vm.state.collectAsState()
    AccountScreen(
        s, modifier,
        onSignIn = onSignIn,
        onPassword = vm::changePassword,
        onStartKey = vm::startKey,
        onConfirmKey = vm::confirmKey,
        onCancelKey = vm::cancelKey,
        onTurnOff = vm::turnOff,
        onForget = vm::forgetDevices,
        onSignOut = { vm.signOut {} },
    )
}

/** Password, two-factor and remembered devices of the admin account, from the phone. */
@Composable
fun AccountScreen(
    s: AccountState,
    modifier: Modifier = Modifier,
    onSignIn: () -> Unit = {},
    onPassword: (String, String) -> Unit = { _, _ -> },
    onStartKey: (String?) -> Unit = {},
    onConfirmKey: (String) -> Unit = {},
    onCancelKey: () -> Unit = {},
    onTurnOff: (String) -> Unit = {},
    onForget: () -> Unit = {},
    onSignOut: () -> Unit = {},
) {
    BoxWithConstraints(modifier.fillMaxSize().background(Mx.colors.page)) {
        val wide = maxWidth >= MxLayout.twoPane
        Column(
            Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = MxLayout.gutter, vertical = MxSpace.s),
            verticalArrangement = Arrangement.spacedBy(MxSpace.s),
        ) {
            s.notice?.let { Notice(it) }
            val a = s.account
            if (s.signedIn == false || a == null) {
                MxCard {
                    Text(stringResource(R.string.account_signed_out), style = MxType.body, color = Mx.colors.sub)
                    MxButton(stringResource(R.string.signin_button), onSignIn)
                }
                return@Column
            }
            if (wide) {
                Row(horizontalArrangement = Arrangement.spacedBy(MxSpace.s)) {
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(MxSpace.s)) {
                        WhoCard(a, onSignOut)
                        PasswordCard(s.busy, onPassword)
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(MxSpace.s)) {
                        TwoFactorCard(s, onStartKey, onConfirmKey, onCancelKey, onTurnOff)
                        DevicesCard(s.busy, onForget)
                    }
                }
            } else {
                WhoCard(a, onSignOut)
                TwoFactorCard(s, onStartKey, onConfirmKey, onCancelKey, onTurnOff)
                PasswordCard(s.busy, onPassword)
                DevicesCard(s.busy, onForget)
            }
        }
    }
}

@Composable
private fun Notice(code: String) {
    val ok = code.startsWith("ok:")
    val text = stringResource(
        when (code) {
            "ok:password" -> R.string.account_ok_password
            "ok:totp" -> R.string.account_ok_totp
            "ok:off" -> R.string.account_ok_off
            "ok:devices" -> R.string.account_ok_devices
            "wrong_password" -> R.string.account_err_password
            "invalid_input" -> R.string.account_err_short
            "code_needed" -> R.string.account_err_code_needed
            "wrong_code" -> R.string.account_err_code
            "home_only" -> R.string.account_err_home_only
            "forced_public" -> R.string.account_err_forced
            else -> R.string.account_err_other
        },
    )
    Text(
        text,
        style = MxType.label,
        color = if (ok) Mx.colors.ok else Mx.colors.danger,
        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(MxRadius.control)).background(Mx.colors.surface).padding(MxSpace.m),
    )
}

@Composable
private fun WhoCard(a: io.github.hchanghyeon.memexhub.notes.AdminClient.Account, onSignOut: () -> Unit) {
    MxCard {
        CardLabel(stringResource(R.string.account_signed_in_as))
        Text(a.username, style = MxType.title, color = Mx.colors.ink)
        Chip(stringResource(if (a.home) R.string.account_at_home else R.string.account_outside))
        MxButton(stringResource(R.string.notes_signout), onSignOut, soft = true)
    }
}

@Composable
private fun TwoFactorCard(s: AccountState, onStart: (String?) -> Unit, onConfirm: (String) -> Unit, onCancel: () -> Unit, onTurnOff: (String) -> Unit) {
    val a = s.account ?: return
    val ctx = LocalContext.current
    val clipboard = LocalClipboard.current
    val scope = rememberCoroutineScope()
    var code by rememberSaveable { mutableStateOf("") }
    var newCode by rememberSaveable { mutableStateOf("") }
    var offPassword by rememberSaveable { mutableStateOf("") }
    var confirmOff by rememberSaveable { mutableStateOf(false) }
    MxCard {
        CardLabel(stringResource(R.string.account_totp))
        StatusDot(
            stringResource(if (a.totp) R.string.account_totp_on else R.string.account_totp_off),
            stringResource(if (a.totp) R.string.account_totp_on_hint else R.string.account_totp_off_hint),
            if (a.totp) Health.Ok else Health.Warn,
        )
        val key = s.newKey
        if (key != null) {
            // Step 2: put the key in the authenticator app (on this phone: open it directly), then its code.
            Text(stringResource(R.string.account_key_steps), style = MxType.body, color = Mx.colors.ink)
            Text(key.chunked(4).joinToString(" "), style = MxType.headline, color = Mx.colors.accent)
            MxButton(stringResource(R.string.account_key_open), onClick = {
                val uri = "otpauth://totp/memexhub:admin?secret=$key&issuer=memexhub".toUri()
                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            })
            MxButton(stringResource(R.string.account_key_copy), soft = true, onClick = {
                scope.launch { clipboard.setClipEntry(ClipEntry(ClipData.newPlainText("memexhub", key))) }
            })
            CodeField(newCode, { newCode = it }, R.string.account_new_code)
            MxButton(stringResource(R.string.account_key_confirm), onClick = { onConfirm(newCode); newCode = "" }, enabled = !s.busy && newCode.length == 6)
            MxButton(stringResource(R.string.account_cancel), onClick = onCancel, soft = true)
            return@MxCard
        }
        if (!a.totp) {
            MxButton(stringResource(R.string.account_totp_turn_on), onClick = { onStart(null) }, enabled = !s.busy)
            return@MxCard
        }
        // Moving to a new phone: from outside the current code proves it is you; at home it is not asked.
        if (!a.home) CodeField(code, { code = it }, R.string.account_current_code)
        MxButton(stringResource(R.string.account_totp_move), onClick = { onStart(code.ifBlank { null }); code = "" }, enabled = !s.busy && (a.home || code.length == 6))
        if (!confirmOff) {
            MxButton(stringResource(R.string.account_totp_turn_off), onClick = { confirmOff = true }, soft = true, enabled = a.home)
            if (!a.home) Text(stringResource(R.string.account_off_home_only), style = MxType.caption, color = Mx.colors.sub)
        } else {
            Text(stringResource(R.string.account_off_warning), style = MxType.body, color = Mx.colors.danger)
            PasswordField(offPassword, { offPassword = it }, R.string.account_current_password)
            MxButton(stringResource(R.string.account_totp_turn_off), onClick = { onTurnOff(offPassword); offPassword = ""; confirmOff = false }, enabled = !s.busy && offPassword.isNotEmpty())
            MxButton(stringResource(R.string.account_cancel), onClick = { confirmOff = false }, soft = true)
        }
    }
}

@Composable
private fun PasswordCard(busy: Boolean, onPassword: (String, String) -> Unit) {
    var current by rememberSaveable { mutableStateOf("") }
    var next by rememberSaveable { mutableStateOf("") }
    var again by rememberSaveable { mutableStateOf("") }
    MxCard {
        CardLabel(stringResource(R.string.account_password))
        PasswordField(current, { current = it }, R.string.account_current_password)
        PasswordField(next, { next = it }, R.string.account_new_password)
        PasswordField(again, { again = it }, R.string.account_new_password_again)
        val mismatch = again.isNotEmpty() && again != next
        Text(
            stringResource(if (mismatch) R.string.account_password_mismatch else R.string.account_password_hint),
            style = MxType.caption, color = if (mismatch) Mx.colors.danger else Mx.colors.sub,
        )
        MxButton(stringResource(R.string.account_password_change), onClick = {
            onPassword(current, next)
            current = ""; next = ""; again = ""
        }, enabled = !busy && current.isNotEmpty() && next.length >= 12 && next == again)
    }
}

@Composable
private fun DevicesCard(busy: Boolean, onForget: () -> Unit) {
    MxCard {
        CardLabel(stringResource(R.string.account_devices))
        Text(stringResource(R.string.account_devices_hint), style = MxType.body, color = Mx.colors.sub)
        MxButton(stringResource(R.string.account_devices_forget), onClick = onForget, soft = true, enabled = !busy)
    }
}

@Composable
private fun PasswordField(value: String, onChange: (String) -> Unit, label: Int) {
    OutlinedTextField(
        value, onChange, label = { Text(stringResource(label)) }, singleLine = true,
        visualTransformation = PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
private fun CodeField(value: String, onChange: (String) -> Unit, label: Int) {
    OutlinedTextField(
        value, { onChange(it.filter(Char::isDigit).take(6)) }, label = { Text(stringResource(label)) }, singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword), modifier = Modifier.fillMaxWidth(),
    )
}
