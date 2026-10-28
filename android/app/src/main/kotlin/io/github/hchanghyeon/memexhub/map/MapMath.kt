package io.github.hchanghyeon.memexhub.map

import kotlin.math.PI
import kotlin.math.atan
import kotlin.math.exp
import kotlin.math.ln
import kotlin.math.log2
import kotlin.math.max
import kotlin.math.min
import kotlin.math.tan

/** Web Mercator in "world pixels": the whole world is 256 × 2^zoom pixels wide, like OSM tiles. */
object MapMath {
    const val TILE = 256.0

    fun x(lon: Double, zoom: Double) = (lon + 180.0) / 360.0 * TILE * Math.pow(2.0, zoom)

    fun y(lat: Double, zoom: Double): Double {
        val r = Math.toRadians(lat.coerceIn(-85.0511, 85.0511))
        return (1.0 - ln(tan(r) + 1.0 / kotlin.math.cos(r)) / PI) / 2.0 * TILE * Math.pow(2.0, zoom)
    }

    fun lon(x: Double, zoom: Double) = x / (TILE * Math.pow(2.0, zoom)) * 360.0 - 180.0

    fun lat(y: Double, zoom: Double): Double {
        val n = PI - 2.0 * PI * y / (TILE * Math.pow(2.0, zoom))
        return Math.toDegrees(atan(0.5 * (exp(n) - exp(-n))))
    }

    /** The zoom at which the box [south, west, north, east] fits a [width] × [height] pixel view with [pad] around. */
    fun fit(south: Double, west: Double, north: Double, east: Double, width: Double, height: Double, pad: Double, maxZoom: Double = 17.0): Double {
        val w = max(x(east, 0.0) - x(west, 0.0), 1e-9)
        val h = max(y(south, 0.0) - y(north, 0.0), 1e-9)
        val zx = log2((width - 2 * pad).coerceAtLeast(1.0) / w)
        val zy = log2((height - 2 * pad).coerceAtLeast(1.0) / h)
        return min(min(zx, zy), maxZoom).coerceIn(3.0, maxZoom)
    }
}
