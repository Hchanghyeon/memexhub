package io.github.hchanghyeon.memexhub

import io.github.hchanghyeon.memexhub.map.MapMath
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MapMathTest {
    @Test
    fun projectsLikeOsmTiles() {
        // Zoom 0 is one 256 px tile; the centre of the world is (128, 128).
        assertEquals(128.0, MapMath.x(0.0, 0.0), 1e-9)
        assertEquals(128.0, MapMath.y(0.0, 0.0), 1e-9)
        // Seoul City Hall at zoom 15 is in tile x 27941, y 12689.
        assertEquals(27941, (MapMath.x(126.9780, 15.0) / 256).toInt())
        assertEquals(12689, (MapMath.y(37.5665, 15.0) / 256).toInt())
    }

    @Test
    fun goesBackAndForth() {
        val z = 13.0
        assertEquals(37.5665, MapMath.lat(MapMath.y(37.5665, z), z), 1e-9)
        assertEquals(126.978, MapMath.lon(MapMath.x(126.978, z), z), 1e-9)
    }

    @Test
    fun fitsABox() {
        val z = MapMath.fit(37.56, 126.97, 37.58, 126.99, 400.0, 400.0, 32.0)
        assertTrue(z in 13.0..15.0)
        assertEquals(17.0, MapMath.fit(37.5665, 126.978, 37.5665, 126.978, 400.0, 400.0, 32.0), 1e-9)
    }
}
