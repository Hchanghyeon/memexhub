package io.github.hchanghyeon.memexhub.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.server.Records
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

/** Starts location again after a restart or an app update, if it was on. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                if (Records(app).isEnabled(Record.Location)) LocationService.start(app)
            } finally {
                pending.finish()
            }
        }
    }
}
