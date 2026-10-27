package io.github.hchanghyeon.memexhub

import io.github.hchanghyeon.memexhub.server.IngestClient
import io.github.hchanghyeon.memexhub.payments.CardMessages
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ParsingTest {
    @Test
    fun addressKeepsOnlyTheServer() {
        assertEquals("https://memexhub.example.com", IngestClient.normalize(" https://memexhub.example.com/ "))
        assertEquals("https://memexhub.example.com", IngestClient.normalize("https://memexhub.example.com/admin"))
        assertEquals("https://memexhub.example.com", IngestClient.normalize("https://memexhub.example.com/admin/devices"))
        assertEquals("https://memexhub.example.com", IngestClient.normalize("https://memexhub.example.com/mcp"))
        assertEquals("https://memexhub.example.com:8790", IngestClient.normalize("https://memexhub.example.com:8790/ingest/sms"))
        assertEquals("https://example.com/memexhub", IngestClient.normalize("https://example.com/memexhub"))
    }

    @Test
    fun addressMustBeHttps() {
        assertNull(IngestClient.normalize("http://memexhub.example.com"))
        assertNull(IngestClient.normalize("memexhub.example.com"))
        assertNull(IngestClient.normalize("https://"))
        assertNull(IngestClient.normalize("not a url"))
    }

    @Test
    fun onlyPaymentTextsLeaveThePhone() {
        assertTrue(CardMessages.looksLikePayment("[Web발신] 샘플카드 승인 홍*동 12,000원 일시불 10/27 13:49 Sample Cafe"))
        assertTrue(CardMessages.looksLikePayment("샘플카드 취소 12,000원 Sample Cafe"))
        assertFalse(CardMessages.looksLikePayment("[Web발신] 인증번호 [123456]를 입력해 주세요"))
        assertFalse(CardMessages.looksLikePayment("오늘 저녁 7시 어때?"))
    }
}
