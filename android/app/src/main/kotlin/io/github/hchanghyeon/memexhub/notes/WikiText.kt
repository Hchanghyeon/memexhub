package io.github.hchanghyeon.memexhub.notes

/** Obsidian-flavoured Markdown → plain CommonMark the renderer understands, plus the note's front matter. */
object WikiText {
    data class Page(val title: String?, val updated: String?, val tags: String?, val body: String)

    private val wiki = Regex("""(!?)\[\[([^\[\]|#]*)(#[^\[\]|]*)?(?:\|([^\[\]]*))?]]""")

    fun page(text: String): Page {
        val t = text.replace("\r\n", "\n")
        if (!t.startsWith("---\n")) return Page(null, null, null, linkify(t))
        val end = t.indexOf("\n---", 4).takeIf { it > 0 } ?: return Page(null, null, null, linkify(t))
        val meta = t.substring(4, end).lines()
        fun field(name: String) = meta.firstOrNull { it.startsWith("$name:") }?.substringAfter(':')?.trim()?.trim('"')?.ifBlank { null }
        val body = t.substring(end + 4).substringAfter('\n', "")
        return Page(field("title"), field("updated"), field("tags")?.removePrefix("[")?.removeSuffix("]")?.ifBlank { null }, linkify(body))
    }

    /** `[[note#part|label]]` → `[label](<wiki:note>)`; `![[file]]` → its name. Code blocks are left alone. */
    fun linkify(body: String): String {
        var fenced = false
        return body.lines().joinToString("\n") { line ->
            if (line.trimStart().startsWith("```")) fenced = !fenced
            if (fenced || line.trimStart().startsWith("```")) line
            else wiki.replace(line) { m ->
                val (bang, target, part, alias) = m.destructured
                val label = alias.ifBlank { target.ifBlank { part.removePrefix("#") } }
                when {
                    bang == "!" -> "📎 $label"
                    target.isBlank() -> label
                    else -> "[$label](<wiki:${target.replace(">", "")}>)"
                }
            }
        }
    }

    /** Which file a wiki link means: the exact path, else the note with that name (shortest path wins). */
    fun resolve(target: String, files: List<String>): String? {
        val t = target.trim().removeSuffix(".md")
        files.firstOrNull { it.removeSuffix(".md").equals(t, ignoreCase = true) }?.let { return it }
        val name = t.substringAfterLast('/')
        return files.filter { it.endsWith(".md") && it.substringAfterLast('/').removeSuffix(".md").equals(name, ignoreCase = true) }
            .minByOrNull { it.length }
    }
}
