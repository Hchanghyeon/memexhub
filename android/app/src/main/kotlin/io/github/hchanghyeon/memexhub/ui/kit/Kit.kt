package io.github.hchanghyeon.memexhub.ui.kit

import android.provider.Settings
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalInspectionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import io.github.hchanghyeon.memexhub.ui.theme.Mx
import io.github.hchanghyeon.memexhub.ui.theme.MxLayout
import io.github.hchanghyeon.memexhub.ui.theme.MxMotion
import io.github.hchanghyeon.memexhub.ui.theme.MxRadius
import io.github.hchanghyeon.memexhub.ui.theme.MxSpace
import io.github.hchanghyeon.memexhub.ui.theme.MxType
import java.text.NumberFormat
import java.util.Locale

/** Whether the system asks for less motion (animations off in developer or accessibility settings). */
@Composable
fun reducedMotion(): Boolean {
    if (LocalInspectionMode.current) return true
    val ctx = LocalContext.current
    return remember { Settings.Global.getFloat(ctx.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f) == 0f }
}

/** Shrinks a little while pressed and ticks the haptics on click: everything tappable uses it. */
@Composable
fun Modifier.pressable(onClick: () -> Unit, role: Role = Role.Button): Modifier {
    val source = remember { MutableInteractionSource() }
    val pressed by source.collectIsPressedAsState()
    val scale by animateFloatAsState(if (pressed && !reducedMotion()) MxMotion.pressScale else 1f, tween(120), label = "press")
    val haptics = LocalHapticFeedback.current
    return this
        .scale(scale)
        .clickable(interactionSource = source, indication = null, role = role) {
            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
            onClick()
        }
}

/** A white block on the grey page. No shadow: the page around it does the separating. */
@Composable
fun MxCard(modifier: Modifier = Modifier, onClick: (() -> Unit)? = null, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier
            .fillMaxWidth()
            .then(if (onClick != null) Modifier.pressable(onClick) else Modifier)
            .clip(RoundedCornerShape(MxRadius.card))
            .background(Mx.colors.surface)
            .padding(MxLayout.cardPadding),
        verticalArrangement = Arrangement.spacedBy(MxSpace.s),
        content = content,
    )
}

/** The small grey line above a number or a list. */
@Composable
fun CardLabel(text: String, modifier: Modifier = Modifier, trailing: @Composable (() -> Unit)? = null) {
    Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MxType.label, color = Mx.colors.sub, modifier = Modifier.weight(1f))
        trailing?.invoke()
    }
}

private val won = NumberFormat.getIntegerInstance(Locale.KOREA)

/** The one big number on a card. Counts up once when it first appears, unless motion is reduced. */
@Composable
fun BigNumber(value: Long, modifier: Modifier = Modifier, unit: String = "", of: Long? = null) {
    val still = reducedMotion()
    val shown = remember { Animatable(if (still) value.toFloat() else 0f) }
    LaunchedEffect(value) {
        if (still) shown.snapTo(value.toFloat()) else shown.animateTo(value.toFloat(), tween(MxMotion.numberMs, easing = FastOutSlowInEasing))
    }
    Text(
        buildAnnotatedString {
            append(won.format(shown.value.toLong()))
            withStyle(SpanStyle(fontSize = MxType.title.fontSize, color = Mx.colors.sub)) {
                if (of != null) append(" / ${won.format(of)}")
            }
            if (unit.isNotEmpty()) withStyle(SpanStyle(fontSize = MxType.title.fontSize)) { append(unit) }
        },
        style = MxType.display,
        color = Mx.colors.ink,
        modifier = modifier,
    )
}

/** One line under a big number; [strong] is drawn in the brand color. */
@Composable
fun Delta(text: String, strong: String? = null) {
    Text(
        buildAnnotatedString {
            val i = strong?.let { text.indexOf(it) } ?: -1
            if (i < 0) append(text) else {
                append(text.substring(0, i))
                withStyle(SpanStyle(color = Mx.colors.accent, fontWeight = MxType.headline.fontWeight)) { append(strong) }
                append(text.substring(i + strong!!.length))
            }
        },
        style = MxType.body,
        color = Mx.colors.sub,
    )
}

@Composable
fun Progress(fraction: Float, modifier: Modifier = Modifier) {
    val f by animateFloatAsState(fraction.coerceIn(0f, 1f), tween(if (reducedMotion()) 0 else MxMotion.numberMs), label = "progress")
    Box(modifier.fillMaxWidth().height(MxSpace.xs).clip(CircleShape).background(Mx.colors.accentSoft)) {
        Box(Modifier.fillMaxWidth(f).height(MxSpace.xs).clip(CircleShape).background(Mx.colors.accent))
    }
}

/** A to-do with a round-cornered box; done ones are struck through. [badge] is a small note such as "이월 3". */
@Composable
fun TodoRow(text: String, done: Boolean, badge: String? = null, onToggle: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().then(if (onToggle != null) Modifier.pressable(onToggle, Role.Checkbox) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MxSpace.s),
    ) {
        Box(
            Modifier.size(MxSpace.xl).clip(RoundedCornerShape(MxSpace.xs))
                .then(if (done) Modifier.background(Mx.colors.accent) else Modifier.border(MxSpace.xxs / 2, Mx.colors.line, RoundedCornerShape(MxSpace.xs))),
            contentAlignment = Alignment.Center,
        ) {
            if (done) Icon(Icons.Filled.Check, null, tint = Mx.colors.onAccent, modifier = Modifier.size(MxSpace.m))
        }
        Text(
            text,
            style = MxType.body.copy(textDecoration = if (done) TextDecoration.LineThrough else null),
            color = if (done) Mx.colors.sub else Mx.colors.ink,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        badge?.let { Chip(it) }
    }
}

@Composable
fun Chip(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MxType.caption,
        color = Mx.colors.accent,
        modifier = modifier.clip(RoundedCornerShape(MxRadius.chip)).background(Mx.colors.accentSoft).padding(horizontal = MxSpace.xs, vertical = MxSpace.xxs / 2),
    )
}

/** A row with a soft square holding one character, a title over a caption, and a value on the right. */
@Composable
fun ListRow(title: String, sub: String? = null, mark: String? = null, value: String? = null, onClick: (() -> Unit)? = null) {
    Row(
        Modifier.fillMaxWidth().then(if (onClick != null) Modifier.pressable(onClick) else Modifier).padding(vertical = MxSpace.xxs),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(MxSpace.s),
    ) {
        if (mark != null) {
            Box(Modifier.size(MxSpace.xl + MxSpace.s).clip(RoundedCornerShape(MxSpace.s)).background(Mx.colors.accentSoft), contentAlignment = Alignment.Center) {
                Text(mark.take(1), style = MxType.headline, color = Mx.colors.accent)
            }
        }
        Column(Modifier.weight(1f)) {
            Text(title, style = MxType.headline, color = Mx.colors.ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            sub?.let { Text(it, style = MxType.caption, color = Mx.colors.sub, maxLines = 1, overflow = TextOverflow.Ellipsis) }
        }
        value?.let { Text(it, style = MxType.headline, color = Mx.colors.ink) }
    }
}

enum class Health { Ok, Warn, Off }

/** State as a dot and a word, never color alone. */
@Composable
fun StatusDot(title: String, sub: String, health: Health, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(MxSpace.xxs / 2)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(MxSpace.xs)) {
            Box(Modifier.size(MxSpace.xs).clip(CircleShape).background(when (health) { Health.Ok -> Mx.colors.ok; Health.Warn -> Mx.colors.warn; Health.Off -> Mx.colors.line }))
            Text(title, style = MxType.label, color = Mx.colors.ink)
        }
        Text(sub, style = MxType.caption, color = if (health == Health.Warn) Mx.colors.warn else Mx.colors.sub)
    }
}

/** Primary (brand color) or soft button, full width, with the press feedback. */
@Composable
fun MxButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, soft: Boolean = false, enabled: Boolean = true) {
    Box(
        modifier
            .fillMaxWidth()
            .then(if (enabled) Modifier.pressable(onClick) else Modifier)
            .clip(RoundedCornerShape(MxRadius.control))
            .background(if (soft) Mx.colors.accentSoft else if (enabled) Mx.colors.accent else Mx.colors.line)
            .padding(vertical = MxSpace.m),
        contentAlignment = Alignment.Center,
    ) {
        Text(text, style = MxType.label, color = if (soft) Mx.colors.accent else Mx.colors.onAccent)
    }
}

/** A screen title with an optional line on the right (a date). */
@Composable
fun ScreenTitle(title: String, modifier: Modifier = Modifier, aside: String? = null) {
    Row(modifier.fillMaxWidth().padding(top = MxSpace.xs, bottom = MxSpace.xxs), verticalAlignment = Alignment.Bottom) {
        Text(title, style = MxType.title, color = Mx.colors.ink, modifier = Modifier.weight(1f))
        aside?.let { Text(it, style = MxType.body, color = Mx.colors.sub) }
    }
}
