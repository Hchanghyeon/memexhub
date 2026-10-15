import { ISSUERS, type SmsIssuer, type SmsPayment } from "./issuers/index.js";
import { nowIn, zonedIso } from "../../core/time.js";

export class SmsParseError extends Error {}

const AMOUNT = /(?<!누적)(?<!누적 )(?<![\d,])([\d,]*\d)\s*원/;
const TIME = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;
const FOREIGN = /\b([A-Z]{3})\s*(\d[\d,]*(?:\.\d+)?)/;
// one-line notices: '…님 MM/DD 가맹점 사용 N원 …' · '…님 MM/DD 해외사용 가맹점 USD 1.00 …'
const ONELINE = /님\s+\d{1,2}\/\d{1,2}\s+(?:해외사용\s+)?(.+?)\s+(?:사용\s+)?(?:[\d,]*\d\s*원|[A-Z]{3}\s*\d)/;
const MASKED_NAME = /^[가-힣A-Za-z]\*[가-힣A-Za-z*]+$/;

function noise(line: string) {
  return (
    line.includes("누적") || AMOUNT.test(line) || ISSUERS.some((i) => i.detect.test(line)) || MASKED_NAME.test(line) || ["승인", "취소", "일시불"].includes(line)
  );
}

/** Parse a Korean card approval/cancellation SMS. Throws SmsParseError for anything else. */
export function parseCardSms(raw: string, opts: { tz: string; now?: Date; issuers?: SmsIssuer[] }): SmsPayment {
  const text = (raw ?? "").replace(/\r/g, "").slice(0, 2000);
  const issuer = (opts.issuers ?? ISSUERS).find((i) => i.detect.test(text));
  if (!issuer) throw new SmsParseError("not a supported card issuer");
  const cancel = text.includes("취소");
  if (!cancel && !text.includes("승인")) throw new SmsParseError("not an approval or cancellation");
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l && l !== "[Web발신]");

  let amountLine = "";
  let amount = "";
  for (const l of lines) {
    const m = l.match(AMOUNT);
    if (m) {
      amountLine = l;
      amount = `${cancel ? "-" : ""}₩${m[1]}`;
      break;
    }
  }
  if (!amount) {
    const l = lines.find((x) => FOREIGN.test(x));
    if (!l) throw new SmsParseError("no amount");
    const fx = l.match(FOREIGN)!;
    amountLine = l;
    amount = `${cancel ? "-" : ""}${fx[1]} ${fx[2]}`;
  }
  let plan = "";
  if (!cancel) {
    const inst = amountLine.match(/(\d+)\s*개월/);
    plan = inst ? `${inst[1]}개월` : amountLine.includes("일시불") ? "일시불" : "";
  }
  const card = issuer.cardName(lines);

  let time = "";
  let tIdx = -1;
  let merchant = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const tm = l.match(TIME);
    if (!tm) continue;
    const now = nowIn(opts.tz, opts.now);
    const [mo, dd, hh, mi] = tm.slice(1).map(Number) as [number, number, number, number];
    const year = mo === 12 && now.m === 1 ? now.y - 1 : now.y;
    time = zonedIso(opts.tz, year, mo, dd, hh, mi);
    tIdx = i;
    const rest = l.slice(tm.index! + tm[0].length).split("누적")[0]!.replace(/^[\s·,]+|[\s·,]+$/g, "");
    if (rest && !noise(rest)) merchant = rest;
    break;
  }
  if (!merchant) {
    const om = text.match(ONELINE);
    if (om) merchant = om[1]!.trim();
  }
  if (!merchant) for (const l of tIdx >= 0 ? lines.slice(tIdx + 1) : lines) if (!noise(l)) {
    merchant = l;
    break;
  }
  return {
    merchant: (merchant || "가맹점 없음").slice(0, 200),
    amount,
    card: card + (plan ? ` ${plan}` : "") + (cancel ? " 취소" : ""),
    time,
    source: "sms",
  };
}
