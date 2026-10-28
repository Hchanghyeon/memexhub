package io.github.hchanghyeon.memexhub.map

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.gestures.detectTransformGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import io.github.hchanghyeon.memexhub.ui.kit.Chip
import io.github.hchanghyeon.memexhub.ui.kit.pressable
import io.github.hchanghyeon.memexhub.ui.theme.Mx
import io.github.hchanghyeon.memexhub.ui.theme.MxRadius
import io.github.hchanghyeon.memexhub.ui.theme.MxSpace
import io.github.hchanghyeon.memexhub.ui.theme.MxType
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.log2
import kotlin.math.pow

/** Where the map looks: the centre in zoom-0 world units and a fractional zoom. */
data class Camera(val cx: Double, val cy: Double, val zoom: Double)

/**
 * A light map drawn from OSM tiles the server caches, the day's path and numbered stays.
 * Drag to move, pinch to zoom, tap a stay to pick it. No Google services and no API key.
 */
@Composable
fun MapView(
    day: MapDay?,
    selected: Int?,
    tile: (Int, Int, Int) -> ImageBitmap?,
    need: (Int, Int, Int) -> Unit,
    onSelect: (Int?) -> Unit,
    fitLabel: String,
    modifier: Modifier = Modifier,
) {
    val density = LocalDensity.current.density
    var size by remember { mutableStateOf(IntSize.Zero) }
    var camera by remember(day) { mutableStateOf<Camera?>(null) }
    val colors = Mx.colors
    val measurer = rememberTextMeasurer()

    fun fit(): Camera? {
        if (size.width == 0) return null
        val pts = day?.path.orEmpty() + day?.stays.orEmpty().map { it.lat to it.lon }
        if (pts.isEmpty()) return Camera(MapMath.x(126.978, 0.0), MapMath.y(37.5665, 0.0), 11.0)
        val s = pts.minOf { it.first }; val n = pts.maxOf { it.first }
        val w = pts.minOf { it.second }; val e = pts.maxOf { it.second }
        val z = MapMath.fit(s, w, n, e, size.width / density.toDouble(), size.height / density.toDouble(), 32.0)
        return Camera((MapMath.x(w, 0.0) + MapMath.x(e, 0.0)) / 2, (MapMath.y(n, 0.0) + MapMath.y(s, 0.0)) / 2, z)
    }
    LaunchedEffect(day, size) { if (camera == null) camera = fit() }
    // Picking a stay in the list brings it to the middle.
    LaunchedEffect(selected) {
        val st = selected?.let { day?.stays?.getOrNull(it) } ?: return@LaunchedEffect
        camera = camera?.copy(cx = MapMath.x(st.lon, 0.0), cy = MapMath.y(st.lat, 0.0), zoom = maxOf(camera!!.zoom, 15.0))
    }

    val cam = camera
    // Tiles covering the view at the integer zoom below the current one.
    val tz = cam?.let { floor(it.zoom).toInt().coerceIn(3, 19) } ?: 3
    val visible = remember(cam, size) {
        if (cam == null || size.width == 0) emptyList() else {
            val scale = 2.0.pow(cam.zoom) * density
            val left = cam.cx - size.width / 2.0 / scale; val right = cam.cx + size.width / 2.0 / scale
            val top = cam.cy - size.height / 2.0 / scale; val bottom = cam.cy + size.height / 2.0 / scale
            val n = 1 shl tz
            val k = n / MapMath.TILE
            (floor(top * k).toInt()..floor(bottom * k).toInt()).filter { it in 0 until n }.flatMap { y ->
                (floor(left * k).toInt()..floor(right * k).toInt()).map { x -> Triple(tz, x, y) }
            }
        }
    }
    LaunchedEffect(visible) { visible.forEach { (z, x, y) -> need(z, Math.floorMod(x, 1 shl z), y) } }

    Box(modifier.clip(RoundedCornerShape(MxRadius.card)).background(colors.sunken)) {
        Canvas(
            Modifier.fillMaxSize()
                .onSizeChanged { size = it }
                .pointerInput(day) {
                    detectTransformGestures { centroid, pan, zoomChange, _ ->
                        val c = camera ?: return@detectTransformGestures
                        val s0 = 2.0.pow(c.zoom) * density
                        val wx = c.cx + (centroid.x - size.width / 2.0) / s0
                        val wy = c.cy + (centroid.y - size.height / 2.0) / s0
                        val z = (c.zoom + log2(zoomChange.toDouble())).coerceIn(3.0, 19.0)
                        val s1 = 2.0.pow(z) * density
                        camera = Camera(
                            wx - (centroid.x - size.width / 2.0) / s1 - pan.x / s1,
                            wy - (centroid.y - size.height / 2.0) / s1 - pan.y / s1,
                            z,
                        )
                    }
                }
                .pointerInput(day, camera) {
                    detectTapGestures { pos ->
                        val c = camera ?: return@detectTapGestures
                        val scale = 2.0.pow(c.zoom) * density
                        val hit = day?.stays?.withIndex()?.minByOrNull { (_, st) ->
                            hypot((MapMath.x(st.lon, 0.0) - c.cx) * scale + size.width / 2 - pos.x, (MapMath.y(st.lat, 0.0) - c.cy) * scale + size.height / 2 - pos.y)
                        }
                        val near = hit?.let { (_, st) ->
                            hypot((MapMath.x(st.lon, 0.0) - c.cx) * scale + size.width / 2 - pos.x, (MapMath.y(st.lat, 0.0) - c.cy) * scale + size.height / 2 - pos.y) < 28 * density
                        } == true
                        onSelect(if (near) hit!!.index else null)
                    }
                },
        ) {
            val c = cam ?: return@Canvas
            val scale = 2.0.pow(c.zoom) * density
            fun px(lat: Double, lon: Double) = Offset(
                ((MapMath.x(lon, 0.0) - c.cx) * scale + size.width / 2).toFloat(),
                ((MapMath.y(lat, 0.0) - c.cy) * scale + size.height / 2).toFloat(),
            )
            val tilePx = MapMath.TILE / (1 shl tz) * scale
            for ((z, x, y) in visible) {
                val img = tile(z, Math.floorMod(x, 1 shl z), y) ?: continue
                val ox = ((x * MapMath.TILE / (1 shl z) - c.cx) * scale + size.width / 2)
                val oy = ((y * MapMath.TILE / (1 shl z) - c.cy) * scale + size.height / 2)
                drawImage(img, dstOffset = IntOffset(ox.toInt(), oy.toInt()), dstSize = IntSize(tilePx.toInt() + 1, tilePx.toInt() + 1))
            }
            val path = day?.path.orEmpty()
            if (path.size > 1) {
                val p = Path()
                path.forEachIndexed { i, (lat, lon) -> px(lat, lon).let { if (i == 0) p.moveTo(it.x, it.y) else p.lineTo(it.x, it.y) } }
                drawPath(p, colors.surface, style = Stroke(7.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
                drawPath(p, colors.accent, style = Stroke(4.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
            }
            day?.stays?.forEachIndexed { i, st ->
                val o = px(st.lat, st.lon)
                val r = (if (i == selected) 15 else 11).dp.toPx()
                drawCircle(colors.surface, r + 3.dp.toPx(), o)
                drawCircle(if (i == selected) colors.ink else colors.accent, r, o)
                val label = measurer.measure("${i + 1}", MxType.caption.copy(color = colors.onAccent))
                drawText(label, topLeft = Offset(o.x - label.size.width / 2f, o.y - label.size.height / 2f))
            }
        }
        day?.attribution?.takeIf { it.isNotBlank() }?.let {
            Text(
                it, style = MxType.caption, color = colors.sub,
                modifier = Modifier.align(Alignment.BottomEnd).padding(MxSpace.xs).clip(RoundedCornerShape(MxRadius.control)).background(colors.surface).padding(horizontal = MxSpace.xs),
            )
        }
        Chip(fitLabel, Modifier.align(Alignment.TopEnd).padding(MxSpace.s).pressable({ camera = fit(); onSelect(null) }))
    }
}
