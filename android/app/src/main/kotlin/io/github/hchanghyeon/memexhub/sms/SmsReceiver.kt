package io.github.hchanghyeon.memexhub.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.server.Records
import io.github.hchanghyeon.memexhub.server.Sender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/** Card payment texts → `/ingest/message` (channel sms). The server's recipes do the reading. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (!Records(app).isEnabled(Record.Sms)) return@launch
                // A long text arrives in parts; join them per sender.
                parts.groupBy { it.originatingAddress.orEmpty() }.forEach { (from, msgs) ->
                    val text = msgs.joinToString("") { it.messageBody.orEmpty() }
                    if (CardMessages.looksLikePayment(text)) {
                        Sender.enqueue(app, Record.Sms, "/ingest/message", CardMessages.json(from, text, msgs.first().timestampMillis))
                    }
                }
            } finally {
                pending.finish()
            }
        }
    }
}

object CardMessages {
    /** The words every Korean card company puts in a payment or cancellation text. */
    val words = listOf("승인", "결제", "취소")

    /** Only these texts leave the phone; everything else (codes, chats) stays. */
    fun looksLikePayment(text: String) = words.any { it in text }

    fun json(from: String, text: String, time: Long): String = JSONObject()
        .put("channel", "sms")
        .put("from", from.take(200))
        .put("text", text.take(4000))
        .put("time", OffsetDateTime.ofInstant(Instant.ofEpochMilli(time), ZoneId.systemDefault()).truncatedTo(ChronoUnit.SECONDS).toString())
        .toString()
}
