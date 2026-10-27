package io.github.hchanghyeon.memexhub

import io.github.hchanghyeon.memexhub.today.Daily
import io.github.hchanghyeon.memexhub.today.Todo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class DailyTest {
    @Test
    fun findsTheDaysNote() {
        val files = listOf("Inbox/2026-10-27.md", "40-Journal/2026/10/2026-10-27.md", "40-Journal/2026/10/2026-10-26.md")
        assertEquals("Inbox/2026-10-27.md", Daily.noteFor("2026-10-27", files.filter { "Journal" !in it || "26" in it.takeLast(5) }))
        assertEquals("journal/2026-10-27.md", Daily.noteFor("2026-10-27", listOf("a/b/c/2026-10-27.md", "journal/2026-10-27.md")))
        assertNull(Daily.noteFor("2026-10-28", files))
    }

    @Test
    fun readsTheTodoSectionOnly() {
        val note = """
            |# 2026-10-27
            |
            |## 오늘 할 일 (자동)
            |- [ ] 지원서 마무리
            |- [x] **아침 운동** 30분
            |- [ ] 폰 토큰 바꾸기: [[Sample note|샘플]] 참고 · 근거([[memexhub]] 10-17) (이월 3)
            |- 그냥 목록
            |
            |## 한 일
            |- [ ] 이건 다른 칸
        """.trimMargin()
        assertEquals(
            listOf(
                Todo("지원서 마무리", false),
                Todo("아침 운동 30분", true),
                Todo("폰 토큰 바꾸기: 샘플 참고", false, "이월 3"),
            ),
            Daily.todos(note),
        )
        assertEquals(emptyList<Todo>(), Daily.todos("# 메모\n- [ ] stray"))
    }
}
