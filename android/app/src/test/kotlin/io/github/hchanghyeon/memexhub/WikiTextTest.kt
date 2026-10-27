package io.github.hchanghyeon.memexhub

import io.github.hchanghyeon.memexhub.notes.WikiText
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WikiTextTest {
    @Test
    fun frontMatterIsReadAndRemoved() {
        val p = WikiText.page("---\ntitle: Sample\nupdated: 2026-10-27\ntags: [주제/예시, 상태/진행중]\n---\n\n# Body\n")
        assertEquals("Sample", p.title)
        assertEquals("2026-10-27", p.updated)
        assertEquals("주제/예시, 상태/진행중", p.tags)
        assertEquals("\n# Body\n", p.body)
        assertNull(WikiText.page("no front matter").title)
    }

    @Test
    fun wikiLinksBecomeLinks() {
        assertEquals("see [Sample note](<wiki:Sample note>)", WikiText.linkify("see [[Sample note]]"))
        assertEquals("[label](<wiki:Folder/Note>)", WikiText.linkify("[[Folder/Note#Part|label]]"))
        assertEquals("[Note](<wiki:Note>)", WikiText.linkify("[[Note#Part]]"))
        assertEquals("Part", WikiText.linkify("[[#Part]]"))
        assertEquals("📎 photo.png", WikiText.linkify("![[photo.png]]"))
        assertEquals("```\n[[kept]]\n```", WikiText.linkify("```\n[[kept]]\n```"))
    }

    @Test
    fun linksResolveByPathThenName() {
        val files = listOf("10-Projects/Sample.md", "90-Archive/old/Sample.md", "Home.md", "20-Areas/Dev/Server list.md")
        assertEquals("Home.md", WikiText.resolve("Home", files))
        assertEquals("10-Projects/Sample.md", WikiText.resolve("sample", files))
        assertEquals("90-Archive/old/Sample.md", WikiText.resolve("90-Archive/old/Sample", files))
        assertEquals("20-Areas/Dev/Server list.md", WikiText.resolve("Server list", files))
        assertNull(WikiText.resolve("Missing", files))
    }
}
