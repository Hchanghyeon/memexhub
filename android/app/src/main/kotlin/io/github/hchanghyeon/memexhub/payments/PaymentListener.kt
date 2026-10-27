package io.github.hchanghyeon.memexhub.payments

import android.app.Notification
import android.content.ComponentName
import android.content.Context
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.server.Records
import io.github.hchanghyeon.memexhub.server.Sender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Card texts and wallet payments, read from the notifications they show, then sent to
 * `/ingest/message`. No SMS permission: Galaxy phones in Korea refuse to install sideloaded apps
 * that receive texts (the pattern of smishing apps). Only notifications from the apps below that
 * contain 승인 · 결제 · 취소 leave the phone.
 */
class PaymentListener : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val seen = object : LinkedHashMap<Int, Unit>(64, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, Unit>?) = size > 100
    }

    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val record = when (sbn.packageName) {
            in MESSAGE_APPS -> Record.Sms
            in WALLET_APPS -> Record.Pay
            else -> return
        }
        val n = sbn.notification
        if (n.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val (from, text, time) = read(sbn) ?: return
        if (!CardMessages.looksLikePayment(text)) return
        // Apps re-post the same notification (updates, re-alerts); send each message once.
        val id = (sbn.packageName + from + text).hashCode()
        synchronized(seen) {
            if (seen.containsKey(id)) return
            seen[id] = Unit
        }
        scope.launch {
            if (!Records(this@PaymentListener).isEnabled(record)) return@launch
            val channel = if (record == Record.Sms) "sms" else "notification"
            Sender.enqueue(this@PaymentListener, record, "/ingest/message", CardMessages.json(channel, from, text, time))
        }
    }

    /** Sender (or app), the full text, and when it arrived. Messaging apps use MessagingStyle. */
    private fun read(sbn: StatusBarNotification): Triple<String, String, Long>? {
        val n = sbn.notification
        NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(n)?.messages?.lastOrNull()?.let { m ->
            val from = n.extras.getCharSequence(Notification.EXTRA_CONVERSATION_TITLE)?.toString()
                ?: m.person?.name?.toString()
                ?: n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
            val text = m.text?.toString() ?: return null
            return Triple(from, text, m.timestamp.takeIf { it > 0 } ?: sbn.postTime)
        }
        val title = n.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString().orEmpty()
        val body = (n.extras.getCharSequence(Notification.EXTRA_BIG_TEXT) ?: n.extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()
            ?: return null
        return if (sbn.packageName in MESSAGE_APPS) Triple(title, body, sbn.postTime)
        else Triple(appName(sbn.packageName), "$title\n$body".trim(), sbn.postTime)
    }

    private fun appName(pkg: String) = runCatching {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    }.getOrDefault(pkg)

    override fun onDestroy() {
        scope.cancel()
        super.onDestroy()
    }

    companion object {
        /** Text message apps: their notifications carry the card company's text. */
        val MESSAGE_APPS = setOf("com.samsung.android.messaging", "com.google.android.apps.messaging")

        /** Wallet apps that notify each payment. */
        val WALLET_APPS = setOf("com.samsung.android.spay")

        fun allowed(context: Context) = context.packageName in NotificationManagerCompat.getEnabledListenerPackages(context)

        fun component(context: Context) = ComponentName(context, PaymentListener::class.java)
    }
}
