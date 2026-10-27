package io.github.hchanghyeon.memexhub.today

/** A to-do from the day's note: `- [ ] text`. [badge] carries notes such as "이월 3". */
data class Todo(val text: String, val done: Boolean, val badge: String? = null)

/** Reading the day's note (the journal page the night routine writes) without knowing the vault's layout. */
object Daily {
    private val heading = Regex("""^#{1,4}\s+(.*)$""")
    private val item = Regex("""^\s*[-*+]\s+\[([ xX])]\s+(.+)$""")
    private val carried = Regex("""\s*\((이월\s*\d+|carried\s*\d+)\)\s*""")
    private val wiki = Regex("""\[\[([^\]|]*)(?:\|([^\]]*))?]]""")

    /** The note for [date] (YYYY-MM-DD): a file named after the day, the journal one first. */
    fun noteFor(date: String, files: List<String>): String? =
        files.filter { it.substringAfterLast('/') == "$date.md" }.minByOrNull { if ("일지" in it || "journal" in it.lowercase() || "daily" in it.lowercase()) 0 else it.length }

    /** Checkbox lines under the first heading that talks about to-dos (할 일, to-do, tasks). */
    fun todos(note: String): List<Todo> {
        val lines = note.lines()
        val start = lines.indexOfFirst { l -> heading.find(l)?.groupValues?.get(1)?.let { h -> "할 일" in h || Regex("(?i)to-?do|tasks").containsMatchIn(h) } == true }
        if (start < 0) return emptyList()
        return lines.drop(start + 1).takeWhile { !heading.matches(it) }.mapNotNull { l ->
            val m = item.find(l) ?: return@mapNotNull null
            clean(m.groupValues[2], m.groupValues[1] != " ")
        }
    }

    private fun clean(raw: String, done: Boolean): Todo {
        val badge = carried.find(raw)?.groupValues?.get(1)?.replace(Regex("\\s+"), " ")
        val text = raw.replace(carried, " ")
            .replace(wiki) { it.groupValues[2].ifBlank { it.groupValues[1] } }
            .substringBefore(" · 근거")
            .replace("**", "")
            .replace(Regex("""\s+→\s*\?.*$"""), "")
            .trim().trimEnd(':', '·').trim()
        return Todo(text, done, badge)
    }
}
