import type { SmsIssuer } from "./types.js";

/**
 * Formats seen (all examples are fake):
 *   현대카드 M 승인 / 홍*동 / 12,500원 일시불 / 10/14 12:30 / 샘플카페 / 누적 345,000원
 *   현대 네이버 승인 / …                        ← short form without the word "현대카드"
 *   [현대카드] 홍*동님 09/15 샘플페이(주) 사용 106,800원 취소처리되었습니다      ← one-line notice
 *   [현대카드] 홍*동님 10/13 해외사용 Sample*Shop CNY 21.30 취소처리 되었습니다.
 */
export const hyundai: SmsIssuer = {
  id: "hyundai",
  name: "현대카드",
  detect: /현대카드|^현대\s+\S.*(?:승인|취소)/m,
  cardName(lines) {
    let line = lines.find((l) => l.includes("현대카드") || /^현대\s/.test(l)) ?? "현대카드";
    if (line.startsWith("[현대카드]")) return "현대카드"; // one-line notices carry no product name
    line = line.replace(/^현대\s+/, "현대카드 ");
    return line.replace(/\s*(승인|취소|거절).*$/, "").trim() || "현대카드";
  },
};
