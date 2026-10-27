package io.github.hchanghyeon.memexhub.notes

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import org.commonmark.ext.gfm.strikethrough.Strikethrough
import org.commonmark.ext.gfm.strikethrough.StrikethroughExtension
import org.commonmark.ext.gfm.tables.TableBlock
import org.commonmark.ext.gfm.tables.TableCell
import org.commonmark.ext.gfm.tables.TableHead
import org.commonmark.ext.gfm.tables.TableRow
import org.commonmark.ext.gfm.tables.TablesExtension
import org.commonmark.ext.task.list.items.TaskListItemMarker
import org.commonmark.ext.task.list.items.TaskListItemsExtension
import org.commonmark.node.BlockQuote
import org.commonmark.node.BulletList
import org.commonmark.node.Code
import org.commonmark.node.Emphasis
import org.commonmark.node.FencedCodeBlock
import org.commonmark.node.HardLineBreak
import org.commonmark.node.Heading
import org.commonmark.node.HtmlBlock
import org.commonmark.node.HtmlInline
import org.commonmark.node.IndentedCodeBlock
import org.commonmark.node.Link
import org.commonmark.node.ListItem
import org.commonmark.node.Node
import org.commonmark.node.OrderedList
import org.commonmark.node.Paragraph
import org.commonmark.node.SoftLineBreak
import org.commonmark.node.StrongEmphasis
import org.commonmark.node.ThematicBreak
import org.commonmark.parser.Parser

private val parser = Parser.builder()
    .extensions(listOf(TablesExtension.create(), StrikethroughExtension.create(), TaskListItemsExtension.create()))
    .build()

private fun Node.children(): List<Node> = generateSequence(firstChild) { it.next }.toList()

/** Renders a note read-only. [onLink] gets `wiki:<target>` for wiki links and the URL for the rest. */
@Composable
fun Markdown(text: String, onLink: (String) -> Unit, modifier: Modifier = Modifier) {
    val doc = parser.parse(text)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        doc.children().forEach { Block(it, onLink) }
    }
}

@Composable
private fun Block(node: Node, onLink: (String) -> Unit) {
    val type = MaterialTheme.typography
    when (node) {
        is Heading -> Text(
            inline(node, onLink),
            style = when (node.level) { 1 -> type.headlineSmall; 2 -> type.titleLarge; 3 -> type.titleMedium; else -> type.titleSmall },
            modifier = Modifier.padding(top = if (node.level <= 2) 8.dp else 4.dp),
        )
        is Paragraph -> Text(inline(node, onLink), style = type.bodyLarge)
        is BulletList, is OrderedList -> ListBlock(node, onLink)
        is BlockQuote -> Quote(node, onLink)
        is FencedCodeBlock -> CodeBox(node.literal.trimEnd())
        is IndentedCodeBlock -> CodeBox(node.literal.trimEnd())
        is ThematicBreak -> HorizontalDivider()
        is TableBlock -> Table(node, onLink)
        is HtmlBlock -> Text(node.literal.trim(), style = type.bodyMedium)
        else -> node.children().forEach { Block(it, onLink) }
    }
}

@Composable
private fun ListBlock(list: Node, onLink: (String) -> Unit) {
    var n = (list as? OrderedList)?.markerStartNumber ?: 1
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        list.children().filterIsInstance<ListItem>().forEach { item ->
            val task = item.firstChild?.firstChild as? TaskListItemMarker
            val marker = when {
                task != null -> if (task.isChecked) "☑" else "☐"
                list is OrderedList -> "${n++}."
                else -> "•"
            }
            Row {
                Text(marker, Modifier.width(24.dp), style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    item.children().forEach { Block(it, onLink) }
                }
            }
        }
    }
}

/** Plain quotes and Obsidian callouts (`> [!note] Title`). */
@Composable
private fun Quote(node: BlockQuote, onLink: (String) -> Unit) {
    val first = node.firstChild as? Paragraph
    // The parser may split "[!note] Title" into several text pieces; read the first line whole.
    val parts = first?.children().orEmpty()
    val br = parts.indexOfFirst { it is SoftLineBreak || it is HardLineBreak }.let { if (it < 0) parts.size else it }
    val head = parts.take(br).joinToString("") { (it as? org.commonmark.node.Text)?.literal ?: "" }
    val callout = Regex("""^\[!(\w+)][+-]?\s*(.*)$""").find(head)
    val colors = MaterialTheme.colorScheme
    Column(
        Modifier.fillMaxWidth()
            .background(if (callout != null) colors.surfaceContainer else colors.surface, RoundedCornerShape(8.dp))
            .border(1.dp, colors.outline, RoundedCornerShape(8.dp))
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        if (callout != null) {
            val (kind, title) = callout.destructured
            Text(title.ifBlank { kind.replaceFirstChar { it.uppercase() } }, style = MaterialTheme.typography.titleSmall, color = colors.primary)
            // The rest of the first paragraph after the [!type] line, then the other blocks.
            val rest = inline(parts.drop(br + 1), onLink)
            if (rest.isNotBlank()) Text(rest, style = MaterialTheme.typography.bodyMedium)
            node.children().drop(1).forEach { Block(it, onLink) }
        } else {
            node.children().forEach { Block(it, onLink) }
        }
    }
}

@Composable
private fun CodeBox(code: String) {
    Box(
        Modifier.fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceContainer, RoundedCornerShape(8.dp))
            .horizontalScroll(rememberScrollState())
            .padding(12.dp),
    ) {
        Text(code, fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun Table(table: TableBlock, onLink: (String) -> Unit) {
    val rows = table.children().flatMap { section -> section.children().filterIsInstance<TableRow>().map { (section is TableHead) to it } }
    Column(
        Modifier.horizontalScroll(rememberScrollState())
            .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp)),
    ) {
        rows.forEachIndexed { i, (head, row) ->
            if (i > 0) HorizontalDivider()
            Row(if (head) Modifier.background(MaterialTheme.colorScheme.surfaceContainer) else Modifier) {
                row.children().filterIsInstance<TableCell>().forEach { cell ->
                    Text(
                        inline(cell, onLink),
                        Modifier.width(140.dp).padding(8.dp),
                        style = MaterialTheme.typography.bodySmall,
                        fontWeight = if (head) FontWeight.SemiBold else null,
                    )
                }
            }
        }
    }
}

@Composable
private fun inline(node: Node, onLink: (String) -> Unit): AnnotatedString = inline(node.children(), onLink)

@Composable
private fun inline(nodes: List<Node>, onLink: (String) -> Unit): AnnotatedString {
    val link = TextLinkStyles(SpanStyle(color = MaterialTheme.colorScheme.primary, textDecoration = TextDecoration.Underline))
    val codeBg = MaterialTheme.colorScheme.surfaceContainer
    return buildAnnotatedString {
        fun walk(n: Node) {
            when (n) {
                is org.commonmark.node.Text -> append(n.literal)
                is SoftLineBreak -> append(' ')
                is HardLineBreak -> append('\n')
                is Code -> withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg)) { append(n.literal) }
                is Emphasis -> withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { n.children().forEach(::walk) }
                is StrongEmphasis -> withStyle(SpanStyle(fontWeight = FontWeight.Bold)) { n.children().forEach(::walk) }
                is Strikethrough -> withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { n.children().forEach(::walk) }
                is Link -> withLink(LinkAnnotation.Clickable(n.destination, link) { onLink(n.destination) }) { n.children().forEach(::walk) }
                is HtmlInline -> append(n.literal)
                is TaskListItemMarker -> Unit
                else -> n.children().forEach(::walk)
            }
        }
        nodes.forEach(::walk)
    }
}
