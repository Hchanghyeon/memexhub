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
import android.hardware.Sensor
import android.hardware.SensorManager
import android.hardware.TriggerEvent
import android.hardware.TriggerEventListener
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
import io.github.hchanghyeon.memexhub.server.LocationMode
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.server.Records
import io.github.hchanghyeon.memexhub.server.Sender
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Records where the phone is, to `/ingest/owntracks` in the OwnTracks format, in one of three modes:
 *
 * - **Auto** (default): while moving, a GPS fix every 10 s and a point every 20 m, so paths follow the
 *   roads; while still, one balanced fix every 5 minutes. It wakes up on the motion sensor or when a fix
 *   is far from the last point, and goes back to still after 5 minutes without movement.
 * - **Detailed**: always the moving settings.
 * - **Saver**: a balanced fix every 3 minutes, as before.
 *
 * Points are sent in batches about once a minute. A foreground service with a quiet notification keeps
 * it going while the screen is off.
 */
class LocationService : Service() {
    private lateinit var manager: LocationManager
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var mode = LocationMode.Auto
    private var moving = false
    private var lastKept: Location? = null
    private var lastMoveAt = 0L
    private var moveAnchor: Location? = null
    private val buffer = mutableListOf<String>()
    private var flusher: Job? = null
    private val listener = LocationListener { onLocation(it) }
    private val motion = object : TriggerEventListener() {
        override fun onTrigger(event: TriggerEvent?) {
            if (mode == LocationMode.Auto && !moving) setMoving(true)
        }
    }

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
        scope.launch {
            mode = Records(this@LocationService).locationMode().first()
            moving = mode == LocationMode.Detailed
            listen()
        }
        if (flusher == null) {
            flusher = scope.launch {
                while (isActive) {
                    delay(FLUSH_MS)
                    flush()
                }
            }
        }
        return START_STICKY
    }

    private val fine get() = mode == LocationMode.Detailed || (mode == LocationMode.Auto && moving)

    @SuppressLint("MissingPermission") // canRun() checked it before the service started listening
    private fun listen() {
        manager.removeUpdates(listener)
        val interval = when {
            fine -> MOVING_INTERVAL_MS
            mode == LocationMode.Saver -> SAVER_INTERVAL_MS
            else -> STILL_INTERVAL_MS
        }
        if (Build.VERSION.SDK_INT >= 31 && manager.hasProvider(LocationManager.FUSED_PROVIDER)) {
            val request = LocationRequest.Builder(interval)
                .setQuality(if (fine) LocationRequest.QUALITY_HIGH_ACCURACY else LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
                .setMinUpdateIntervalMillis(if (fine) MOVING_INTERVAL_MS / 2 else MIN_GAP_MS)
                .build()
            manager.requestLocationUpdates(LocationManager.FUSED_PROVIDER, request, mainExecutor, listener)
        } else {
            val providers = if (fine) listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER) else listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
            for (p in providers) {
                if (manager.isProviderEnabled(p)) manager.requestLocationUpdates(p, interval, 0f, listener, Looper.getMainLooper())
            }
        }
        // While still in auto mode, the motion sensor wakes us without keeping GPS on.
        if (mode == LocationMode.Auto && !moving) armMotion()
        updateNotification()
    }

    private fun armMotion() {
        val sm = getSystemService(SensorManager::class.java) ?: return
        sm.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)?.let { sm.requestTriggerSensor(motion, it) }
    }

    private fun setMoving(now: Boolean) {
        if (moving == now) return
        moving = now
        lastMoveAt = System.currentTimeMillis()
        moveAnchor = null
        listen()
    }

    private fun onLocation(loc: Location) {
        val maxAcc = if (fine) MAX_ACCURACY_MOVING_M else MAX_ACCURACY_STILL_M
        if (loc.hasAccuracy() && loc.accuracy > maxAcc) return
        val last = lastKept
        if (mode == LocationMode.Auto) watchMovement(loc, last)
        val keep = when {
            last == null -> true
            fine -> last.distanceTo(loc) >= KEEP_DISTANCE_M || loc.time - last.time >= STILL_INTERVAL_MS
            else -> loc.time - last.time >= MIN_GAP_MS
        }
        if (!keep) return
        lastKept = loc
        synchronized(buffer) { buffer += point(loc) }
        if (buffer.size >= BATCH) scope.launch { flush() }
    }

    /** Auto mode: far from the last point means moving; 5 minutes within 50 m means still again. */
    private fun watchMovement(loc: Location, last: Location?) {
        val now = System.currentTimeMillis()
        if (!moving) {
            if (last != null && last.distanceTo(loc) > WAKE_DISTANCE_M && (!loc.hasAccuracy() || loc.accuracy <= MAX_ACCURACY_MOVING_M)) setMoving(true)
            return
        }
        val anchor = moveAnchor
        if (anchor == null || anchor.distanceTo(loc) > STILL_RADIUS_M || (loc.hasSpeed() && loc.speed > MOVING_SPEED_MPS)) {
            moveAnchor = loc
            lastMoveAt = now
        } else if (now - lastMoveAt > STILL_AFTER_MS) {
            setMoving(false)
        }
    }

    private fun flush() {
        val batch = synchronized(buffer) { buffer.toList().also { buffer.clear() } }
        // The server reads at most 100 points and 8 KB per request.
        batch.chunked(BATCH).forEach { Sender.enqueue(this, Record.Location, "/ingest/owntracks", it.joinToString(",", "[", "]")) }
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, getString(R.string.location_channel), NotificationManager.IMPORTANCE_LOW))
        val open = PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), PendingIntent.FLAG_IMMUTABLE)
        val state = getString(
            when {
                mode == LocationMode.Saver -> R.string.location_state_saver
                fine -> R.string.location_state_moving
                else -> R.string.location_state_still
            },
        )
        return NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher_foreground)
            .setContentTitle(getString(R.string.location_notification))
            .setContentText(state)
            .setContentIntent(open)
            .setOngoing(true)
            .setSilent(true)
            .build()
    }

    private fun updateNotification() {
        getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, notification())
    }

    override fun onDestroy() {
        manager.removeUpdates(listener)
        getSystemService(SensorManager::class.java)?.getDefaultSensor(Sensor.TYPE_SIGNIFICANT_MOTION)?.let {
            getSystemService(SensorManager::class.java).cancelTriggerSensor(motion, it)
        }
        flush()
        scope.cancel()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null

    companion object {
        private const val MOVING_INTERVAL_MS = 10_000L
        private const val STILL_INTERVAL_MS = 300_000L
        private const val SAVER_INTERVAL_MS = 180_000L
        private const val MIN_GAP_MS = 60_000L
        private const val KEEP_DISTANCE_M = 20f
        private const val WAKE_DISTANCE_M = 100f
        private const val STILL_RADIUS_M = 50f
        private const val MOVING_SPEED_MPS = 1.0f
        private const val STILL_AFTER_MS = 300_000L
        private const val MAX_ACCURACY_MOVING_M = 100f
        private const val MAX_ACCURACY_STILL_M = 500f
        private const val FLUSH_MS = 60_000L
        private const val BATCH = 40
        private const val CHANNEL = "location"
        private const val NOTIFICATION_ID = 1

        fun canRun(context: Context) =
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

        /** Starts it, or makes a running one read the mode again. */
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
