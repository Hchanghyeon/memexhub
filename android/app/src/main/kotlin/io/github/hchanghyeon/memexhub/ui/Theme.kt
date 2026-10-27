package io.github.hchanghyeon.memexhub.ui

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// Same rule as the admin app: neutral grays, one accent for the primary action, red only for errors.
private val Accent = Color(0xFF2F5BD3)
private val AccentDark = Color(0xFF9DB4FF)

private val Light = lightColorScheme(
    primary = Accent,
    onPrimary = Color.White,
    background = Color(0xFFFAFAFA),
    surface = Color(0xFFFAFAFA),
    surfaceContainer = Color(0xFFF1F1F2),
    onSurface = Color(0xFF18181B),
    onSurfaceVariant = Color(0xFF52525B),
    outline = Color(0xFFD4D4D8),
    error = Color(0xFFDC2626),
)

private val Dark = darkColorScheme(
    primary = AccentDark,
    onPrimary = Color(0xFF0B1A47),
    background = Color(0xFF111113),
    surface = Color(0xFF111113),
    surfaceContainer = Color(0xFF1C1C1F),
    onSurface = Color(0xFFF4F4F5),
    onSurfaceVariant = Color(0xFFA1A1AA),
    outline = Color(0xFF3F3F46),
    error = Color(0xFFF87171),
)

@Composable
fun MemexhubTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
}
