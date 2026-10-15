export interface SmsPayment {
  merchant: string;
  amount: string; // "₩12,500" · "-₩8,000" · "CNY 21.30"
  card: string; // "현대카드 M 일시불" — never card numbers
  time: string; // ISO with offset, or "" when the SMS has no date/time
  source: "sms";
}

/** Plugin: one card issuer. Only what differs between issuers lives here. */
export interface SmsIssuer {
  id: string;
  name: string; // display name stored with the payment
  detect: RegExp; // does this SMS come from this issuer?
  /** Card label from the SMS lines (e.g. the product name). Never include card numbers. */
  cardName(lines: string[]): string;
}
