package io.github.hchanghyeon.memexhub.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.github.takahirom.roborazzi.captureRoboImage
import io.github.hchanghyeon.memexhub.notes.Markdown
import io.github.hchanghyeon.memexhub.notes.WikiText
import io.github.hchanghyeon.memexhub.server.Delivery
import io.github.hchanghyeon.memexhub.server.Record
import io.github.hchanghyeon.memexhub.today.Money
import io.github.hchanghyeon.memexhub.today.Places
import io.github.hchanghyeon.memexhub.today.RecordState
import io.github.hchanghyeon.memexhub.today.TodayScreen
import io.github.hchanghyeon.memexhub.today.TodayState
import io.github.hchanghyeon.memexhub.today.Todo
import io.github.hchanghyeon.memexhub.ui.theme.MemexhubTheme
import io.github.hchanghyeon.memexhub.ui.theme.Mx
import io.github.hchanghyeon.memexhub.ui.theme.MxLayout
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate
import java.util.Locale

/**
 * Every screen as the Galaxy Z Fold8 shows it: the cover screen (narrow) and the unfolded inner
 * screen (near square), light and dark. Fake data only.
 *   ./gradlew recordRoborazziDebug writes PNGs to app/build/outputs/roborazzi
 */
@RunWith(AndroidJUnit4::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class ScreenshotTest {
    private val now = System.currentTimeMillis()
    private val day = TodayState(
        date = LocalDate.of(2026, 10, 27),
        signedIn = true,
        todos = listOf(
            Todo("아침 운동 30분", true),
            Todo("건강 기록 앱 켜기", true),
            Todo("지원서 마무리", false),
            Todo("관리 화면에서 폰 전용 토큰 만들기", false, "이월 2"),
            Todo("장보기", false),
        ),
        todoNote = "journal/2026-10-27.md",
        money = Money(today = 38_200, count = 4, yesterday = 50_200, month = 1_284_300),
        places = Places(12.4, listOf("집", "회사", "", "회사")),
        records = listOf(
            RecordState(Record.Sms, true, Delivery(now - 3 * 60_000, 200)),
            RecordState(Record.Pay, false, null),
            RecordState(Record.Location, true, Delivery(now - 60_000, 200)),
        ),
    )

    private fun shot(name: String, qualifiers: String, content: @Composable () -> Unit) {
        Locale.setDefault(Locale.KOREA)
        RuntimeEnvironment.setQualifiers(qualifiers)
        captureRoboImage("build/outputs/roborazzi/$name.png") { MemexhubTheme { content() } }
    }

    @Test fun todayCover() = shot("today-cover", COVER) { TodayScreen(day) }
    @Test fun todayCoverDark() = shot("today-cover-dark", COVER_DARK) { TodayScreen(day) }
    @Test fun todayOpen() = shot("today-open", OPEN) { TodayScreen(day) }
    @Test fun todayOpenDark() = shot("today-open-dark", OPEN_DARK) { TodayScreen(day) }
    @Test fun todaySignedOut() = shot("today-signed-out", COVER) { TodayScreen(TodayState(date = day.date, signedIn = false, records = day.records)) }

    @Test fun note() = shot("note-cover", COVER) {
        val page = WikiText.page(
            """
            |---
            |title: 안드로이드 앱
            |updated: 2026-10-27
            |---
            |# 안드로이드 앱
            |
            |> [!note] 완료 조건
            |> 단축어 없이 앱 하나로 결제 · 위치 · 건강이 들어온다.
            |
            |## 지금 상태
            |
            || 기능 | 상태 |
            ||---|---|
            || 카드 문자 | ✅ |
            || 위치 | ✅ |
            |
            |- [x] 노트 탭
            |- [ ] 결제 알림 · [[건강]]
            |
            |```
            |./gradlew assembleDebug
            |```
            """.trimMargin(),
        )
        Box(Modifier.fillMaxSize().background(Mx.colors.surface).verticalScroll(rememberScrollState()).padding(MxLayout.cardPadding)) {
            Markdown(page.body, onLink = {})
        }
    }

    private companion object {
        // Galaxy Z Fold cover screen and unfolded inner screen, in dp.
        // Korean, like the phone; night mode goes before the density in a qualifier string.
        const val COVER = "ko-w411dp-h891dp-xxhdpi"
        const val COVER_DARK = "ko-w411dp-h891dp-night-xxhdpi"
        const val OPEN = "ko-w840dp-h900dp-xxhdpi"
        const val OPEN_DARK = "ko-w840dp-h900dp-night-xxhdpi"
    }
}
