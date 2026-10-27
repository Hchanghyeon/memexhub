package io.github.hchanghyeon.memexhub.payments

import org.json.JSONObject
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

object CardMessages {
    /** The words every Korean card company and wallet puts in a payment or cancellation message. */
    val words = listOf("승인", "결제", "취소")

    /** Only these messages leave the phone; everything else (codes, chats) stays. */
    fun looksLikePayment(text: String) = words.any { it in text }

    /** A `/ingest/message` body: channel `sms` for card texts, `notification` for wallet apps. */
    fun json(channel: String, from: String, text: String, time: Long): String = JSONObject()
        .put("channel", channel)
        .put("from", from.take(200))
        .put("text", text.take(4000))
        .put("time", OffsetDateTime.ofInstant(Instant.ofEpochMilli(time), ZoneId.systemDefault()).truncatedTo(ChronoUnit.SECONDS).toString())
        .toString()
}
