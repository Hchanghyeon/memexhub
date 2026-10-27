package io.github.hchanghyeon.memexhub.server

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.flow.first
import java.util.concurrent.TimeUnit

/**
 * Sends one record. WorkManager keeps the queue across restarts and waits for a network, so a
 * record made on the subway or in airplane mode still arrives later.
 */
object Sender {
    fun enqueue(context: Context, record: Record, path: String, json: String) {
        val work = OneTimeWorkRequestBuilder<PostWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .setInputData(workDataOf("record" to record.name, "path" to path, "json" to json))
            .build()
        WorkManager.getInstance(context).enqueue(work)
    }
}

class PostWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val record = inputData.getString("record")?.let { runCatching { Record.valueOf(it) }.getOrNull() } ?: return Result.failure()
        val path = inputData.getString("path") ?: return Result.failure()
        val json = inputData.getString("json") ?: return Result.failure()
        // Disconnected since: drop it rather than send to whatever server comes next.
        val server = ServerConfig(applicationContext).server.first() ?: return Result.failure()
        val code = runCatching { IngestClient(server).post(path, json) }.getOrNull()
            ?: return if (runAttemptCount < MAX_TRIES) Result.retry() else Result.failure()
        // Busy or down: try again later. Anything else is final (a bad token will not fix itself).
        if ((code == 429 || code >= 500) && runAttemptCount < MAX_TRIES) return Result.retry()
        Records(applicationContext).delivered(record, code)
        return if (code in 200..299) Result.success() else Result.failure()
    }

    private companion object {
        const val MAX_TRIES = 12
    }
}
