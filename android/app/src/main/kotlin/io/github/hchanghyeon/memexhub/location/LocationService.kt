package io.github.hchanghyeon.memexhub.location

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Build
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import io.github.hchanghyeon.memexhub.MainActivity
import io.github.hchanghyeon.memexhub.R
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.server.Sender
import org.json.JSONObject

/**
 * Sends where the phone is every few minutes, like OwnTracks in Move mode, to `/ingest/owntracks`
 * in the same format, so the server needs nothing new. A foreground service with a quiet
 * notification keeps it going while the screen is off.
 */
class LocationService : Service() {
    private lateinit var manager: LocationManager
    private var lastSent = 0L
    private val listener = LocationListener { onLocation(it) }

    override fun onCreate() {
        super.onCreate()
        manager = getSystemService(LocationManager::class.java)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (!canRun(this)) {
            stopSelf()
            return START_NOT_STICKY
        }
        val type = if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION else 0
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(), type)
        listen()
        return START_STICKY
    }

    @SuppressLint("MissingPermission") // canRun() checked it before the service started listening
    private fun listen() {
        manager.removeUpdates(listener)
        if (Build.VERSION.SDK_INT >= 31 && manager.hasProvider(LocationManager.FUSED_PROVIDER)) {
            val request = LocationRequest.Builder(INTERVAL_MS)
                .setQuality(LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
                .setMinUpdateIntervalMillis(MIN_GAP_MS)
                .build()
            manager.requestLocationUpdates(LocationManager.FUSED_PROVIDER, request, mainExecutor, listener)
        } else {
            for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
                if (manager.isProviderEnabled(p)) manager.requestLocationUpdates(p, INTERVAL_MS, 0f, listener, Looper.getMainLooper())
            }
        }
    }

    private fun onLocation(loc: Location) {
        // Rough fixes (cell towers) are kilometres off and only blur the day; two providers can answer at once.
        if (loc.hasAccuracy() && loc.accuracy > MAX_ACCURACY_M) return
        if (loc.time - lastSent < MIN_GAP_MS) return
        lastSent = loc.time
        Sender.enqueue(this, Record.Location, "/ingest/owntracks", point(loc))
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.location_channel), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.location_notification))
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    override fun onDestroy() {
        manager.removeUpdates(listener)
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val INTERVAL_MS = 180_000L
        private const val MIN_GAP_MS = 60_000L
        private const val MAX_ACCURACY_M = 500f
        private const val CHANNEL = "location"
        private const val NOTIFICATION_ID = 1

        fun canRun(context: Context) =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        fun start(context: Context) {
            // From the background without "all the time" Android refuses; the next app start tries again.
            runCatching { ContextCompat.startForegroundService(context, Intent(context, LocationService::class.java)) }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, LocationService::class.java))
        }

        /** The OwnTracks HTTP format memexhub reads. */
        fun point(loc: Location): String = JSONObject()
            .put("_type", "location")
            .put("lat", loc.latitude)
            .put("lon", loc.longitude)
            .put("tst", loc.time / 1000)
            .apply { if (loc.hasAccuracy()) put("acc", loc.accuracy.toInt()) }
            .put("tid", "md")
            .toString()
    }
}
