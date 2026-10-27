package io.github.hchanghyeon.memexhub.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf

private val LocalMx = staticCompositionLocalOf { MxLight }

/** The tokens of the current theme: `Mx.colors.accent`, `MxType.display`, `MxSpace.m`. */
object Mx {
    val colors: MxColors
        @Composable @ReadOnlyComposable get() = LocalMx.current
}

/** Material components follow the tokens too, so a stock Switch or TextField matches the rest. */
private fun scheme(c: MxColors, dark: Boolean) = if (dark) {
    darkColorScheme(
        primary = c.accent, onPrimary = c.onAccent, primaryContainer = c.accentSoft, onPrimaryContainer = c.accent,
        secondary = c.accent, onSecondary = c.onAccent, secondaryContainer = c.accentSoft, onSecondaryContainer = c.ink,
        background = c.page, onBackground = c.ink, surface = c.page, onSurface = c.ink,
        surfaceVariant = c.sunken, onSurfaceVariant = c.sub, surfaceContainer = c.surface, surfaceContainerLow = c.surface,
        surfaceContainerHigh = c.sunken, surfaceContainerHighest = c.sunken, surfaceContainerLowest = c.page,
        outline = c.line, outlineVariant = c.line, error = c.danger, onError = c.onAccent,
    )
} else {
    lightColorScheme(
        primary = c.accent, onPrimary = c.onAccent, primaryContainer = c.accentSoft, onPrimaryContainer = c.accent,
        secondary = c.accent, onSecondary = c.onAccent, secondaryContainer = c.accentSoft, onSecondaryContainer = c.ink,
        background = c.page, onBackground = c.ink, surface = c.page, onSurface = c.ink,
        surfaceVariant = c.sunken, onSurfaceVariant = c.sub, surfaceContainer = c.surface, surfaceContainerLow = c.surface,
        surfaceContainerHigh = c.sunken, surfaceContainerHighest = c.sunken, surfaceContainerLowest = c.page,
        outline = c.line, outlineVariant = c.line, error = c.danger, onError = c.onAccent,
    )
}

private val typography = Typography(
    displayLarge = MxType.display, displayMedium = MxType.display, displaySmall = MxType.display,
    headlineLarge = MxType.title, headlineMedium = MxType.title, headlineSmall = MxType.title,
    titleLarge = MxType.headline, titleMedium = MxType.headline, titleSmall = MxType.label,
    bodyLarge = MxType.body, bodyMedium = MxType.body, bodySmall = MxType.caption,
    labelLarge = MxType.label, labelMedium = MxType.caption, labelSmall = MxType.caption,
)

@Composable
fun MemexhubTheme(content: @Composable () -> Unit) {
    val dark = isSystemInDarkTheme()
    val c = if (dark) MxDark else MxLight
    CompositionLocalProvider(LocalMx provides c) {
        MaterialTheme(colorScheme = scheme(c, dark), typography = typography, content = content)
    }
}
