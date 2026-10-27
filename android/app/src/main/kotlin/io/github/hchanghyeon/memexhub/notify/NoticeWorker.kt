package io.github.hchanghyeon.memexhub.notify

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringSetPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import io.github.hchanghyeon.memexhub.MainActivity
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.server.IngestClient
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.server.Records
import io.github.hchanghyeon.memexhub.server.ServerConfig
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Something that needs a look. [key] stays the same while the problem lasts, so it is shown once. */
data class Notice(val key: String, val title: String, val body: String, val open: Intent, val attention: Boolean = false)

private val Context.notices by preferencesDataStore("notices")
private val shownKey = stringSetPreferencesKey("shown")

/**
 * Every 15 minutes: asks the server what needs a look (`/ingest/status`) and checks this phone's own
 * switches, then notifies only what is new, and clears what got fixed. Only the essentials:
 * a record that stopped, card texts waiting to be checked, a failing connection, a removed
 * permission, a refused token.
 */
class NoticeWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val ctx = applicationContext
        val server = ServerConfig(ctx).server.first() ?: return Result.success()
        val records = Records(ctx)
        val on = Record.entries.associateWith { records.isEnabled(it) }
        val now = mutableListOf<Notice>()

        for ((r, perm) in listOf(Record.Sms to Manifest.permission.RECEIVE_SMS, Record.Location to Manifest.permission.ACCESS_FINE_LOCATION)) {
            if (on[r] == true && ContextCompat.checkSelfPermission(ctx, perm) != PackageManager.PERMISSION_GRANTED) {
                val name = ctx.getString(if (r == Record.Sms) R.string.feature_sms else R.string.feature_location)
                now += Notice("perm:${r.key}", ctx.getString(R.string.notice_permission, name), ctx.getString(R.string.notice_permission_body), appIntent(ctx))
            }
        }

        val (code, body) = runCatching { IngestClient(server).get("/ingest/status") }.getOrElse { return Result.retry() }
        when {
            code == 401 -> now += Notice("token", ctx.getString(R.string.notice_token), ctx.getString(R.string.notice_token_body), appIntent(ctx))
            code in 200..299 -> now += fromStatus(ctx, server.url, JSONObject(body), on)
            // 404: a server older than this app. Anything else: try again next round, keep what is shown.
            code != 404 -> return Result.success()
        }
        show(ctx, now)
        return Result.success()
    }

    private fun fromStatus(ctx: Context, url: String, s: JSONObject, on: Map<Record, Boolean>): List<Notice> {
        val out = mutableListOf<Notice>()
        // Only sources this phone sends: the server may also know others (a watch, a shortcut).
        val mine = mapOf("location" to Record.Location, "ledger" to Record.Sms)
        val names = mapOf("location" to R.string.feature_location, "ledger" to R.string.feature_sms)
        s.optJSONArray("stale")?.let { list ->
            for (i in 0 until list.length()) {
                val o = list.getJSONObject(i)
                val src = o.optString("source")
                if (on[mine[src]] != true) continue
                val hours = o.optInt("hours")
                val span = if (hours >= 48) ctx.resources.getQuantityString(R.plurals.notice_days, hours / 24, hours / 24) else ctx.getString(R.string.notice_hours, hours)
                out += Notice("stale:$src", ctx.getString(R.string.notice_stale, ctx.getString(names.getValue(src)), span), ctx.getString(R.string.notice_stale_body), appIntent(ctx))
            }
        }
        s.optJSONObject("inbox")?.let { inbox ->
            val n = inbox.optInt("pending")
            // A new waiting text makes a new key, so it notifies again; checking them all clears it.
            if (n > 0) out += Notice("inbox:${inbox.optString("newest")}", ctx.resources.getQuantityString(R.plurals.notice_inbox, n, n), ctx.getString(R.string.notice_inbox_body), web(url, "/admin/recipes"), attention = true)
        }
        s.optJSONArray("connectionErrors")?.let { list ->
            for (i in 0 until list.length()) {
                val name = list.getString(i)
                out += Notice("conn:$name", ctx.getString(R.string.notice_connection, name), ctx.getString(R.string.notice_connection_body), web(url, "/admin/connections"))
            }
        }
        return out
    }

    private suspend fun show(ctx: Context, now: List<Notice>) {
        val shown = ctx.notices.data.first()[shownKey] ?: emptySet()
        val nm = NotificationManagerCompat.from(ctx)
        channels(ctx)
        val allowed = android.os.Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        for (n in now) {
            if (n.key in shown || !allowed) continue
            val tap = PendingIntent.getActivity(ctx, n.key.hashCode(), n.open, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val notification = NotificationCompat.Builder(ctx, if (n.attention) CH_ATTENTION else CH_STATUS)
                .setSmallIcon(R.drawable.ic_launcher_foreground)
                .setContentTitle(n.title)
                .setContentText(n.body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(n.body))
                .setContentIntent(tap)
                .setAutoCancel(true)
                .build()
            @Suppress("MissingPermission") // checked above
            nm.notify(n.key, NOTIFY_ID, notification)
        }
        // Fixed since: take the notification away.
        val keys = now.map { it.key }.toSet()
        for (old in shown - keys) nm.cancel(old, NOTIFY_ID)
        ctx.notices.edit { it[shownKey] = if (allowed) keys else shown.intersect(keys) }
    }

    companion object {
        private const val WORK = "notices"
        private const val NOTIFY_ID = 100
        private const val CH_ATTENTION = "attention"
        private const val CH_STATUS = "status"

        fun schedule(context: Context) {
            val work = PeriodicWorkRequestBuilder<NoticeWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, work)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(WORK)
            NotificationManagerCompat.from(context).cancelAll()
        }

        private fun channels(ctx: Context) {
            val nm = ctx.getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel(CH_ATTENTION, ctx.getString(R.string.notice_channel_attention), NotificationManager.IMPORTANCE_DEFAULT))
            nm.createNotificationChannel(NotificationChannel(CH_STATUS, ctx.getString(R.string.notice_channel_status), NotificationManager.IMPORTANCE_DEFAULT))
        }

        private fun appIntent(ctx: Context) = Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)

        private fun web(url: String, path: String) = Intent(Intent.ACTION_VIEW, (url.trimEnd('/') + path).toUri())
    }
}
