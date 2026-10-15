import type { SmsIssuer } from "./types.js";

/**
 * Formats seen (fake examples):
 *   삼성1234승인 홍*동 / 1,500원 일시불 / 10/15 09:11 샘플편의점 / 누적98,765원   ← merchant on the time line
 *   삼성카드 승인 홍*동 / 8,000원 일시불 / 10/15 13:02 / 샘플분식
 */
export const samsung: SmsIssuer = {
  id: "samsung",
  name: "삼성카드",
  detect: /삼성(?:카드\s*\d{0,4}|\d{4})/,
  cardName: () => "삼성카드", // the SMS shows card digits, which we never store
};
