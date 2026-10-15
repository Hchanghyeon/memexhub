import { nowIn, zonedIso } from "../../../core/time.js";

/**
 * Generic reader for Korean card messages: amount, foreign amount, MM/DD HH:mm, approval / cancellation,
 * instalments and the merchant line. Knows no card company — recipes add what differs per sender.
 */
const AMOUNT = /(?<!누적)(?<!누적 )(?<![\d,])([\d,]*\d)\s*원/;
const TIME = /(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})/;
const FOREIGN = /\b([A-Z]{3})\s*(\d[\d,]*(?:\.\d+)?)/;
// one-line notices: '…님 MM/DD 가맹점 사용 N원 …' · '…님 MM/DD 해외사용 가맹점 USD 1.00 …'
const ONELINE = /님\s+\d{1,2}\/\d{1,2}\s+(?:해외사용\s+)?(.+?)\s+(?:사용\s+)?(?:[\d,]*\d\s*원|[A-Z]{3}\s*\d)/;
const MASKED_NAME = /^[가-힣A-Za-z]\*[가-힣A-Za-z*]+$/;
const CARD_WORD = /([가-힣A-Za-z]{1,12}카드)/;

export interface GenericRead {
  amount: string;
  merchant: string;
  time: string;
  plan: string;
  cancel: boolean;
  approval: boolean;
  cardWord: string;
}

export interface GenericOptions {
  tz: string;
  now?: Date;
  /** Lines matching these are headers (sender names), never the merchant. */
  noise?: RegExp[];
  cancel?: RegExp;
}

export const MAX_TEXT = 4000;

export function linesOf(text: string) {
  return text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter((l) => l && l !== "[Web발신]");
}

/** Year for a month/day without a year: December read in January belongs to last year. */
export function zonedFromParts(tz: string, now: Date | undefined, mo: number, dd: number, hh: number, mi: number, year?: number) {
  const n = nowIn(tz, now);
  const y = year ?? (mo === 12 && n.m === 1 ? n.y - 1 : n.y);
  return zonedIso(tz, y, mo, dd, hh, mi);
}

export function genericRead(raw: string, o: GenericOptions): GenericRead {
  const text = (raw ?? "").replace(/\r/g, "").slice(0, MAX_TEXT);
  const noise = o.noise ?? [];
  const isNoise = (line: string) =>
    line.includes("누적") || AMOUNT.test(line) || noise.some((r) => r.test(line)) || MASKED_NAME.test(line) || ["승인", "취소", "일시불"].includes(line);
  const cancel = (o.cancel ?? /취소/).test(text);
  const approval = text.includes("승인");
  const lines = linesOf(text);

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
    if (l) {
      const fx = l.match(FOREIGN)!;
      amountLine = l;
      amount = `${cancel ? "-" : ""}${fx[1]} ${fx[2]}`;
    }
  }
  let plan = "";
  if (!cancel && amountLine) {
    const inst = amountLine.match(/(\d+)\s*개월/);
    plan = inst ? `${inst[1]}개월` : amountLine.includes("일시불") ? "일시불" : "";
  }

  let time = "";
  let tIdx = -1;
  let merchant = "";
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    const tm = l.match(TIME);
    if (!tm) continue;
    const [mo, dd, hh, mi] = tm.slice(1).map(Number) as [number, number, number, number];
    time = zonedFromParts(o.tz, o.now, mo, dd, hh, mi);
    tIdx = i;
    const rest = l.slice(tm.index! + tm[0].length).split("누적")[0]!.replace(/^[\s·,]+|[\s·,]+$/g, "");
    if (rest && !isNoise(rest)) merchant = rest;
    break;
  }
  if (!merchant) {
    const om = text.match(ONELINE);
    if (om) merchant = om[1]!.trim();
  }
  if (!merchant)
    for (const l of tIdx >= 0 ? lines.slice(tIdx + 1) : lines)
      if (!isNoise(l)) {
        merchant = l;
        break;
      }
  return { amount, merchant: merchant.slice(0, 200), time, plan, cancel, approval, cardWord: text.match(CARD_WORD)?.[1] ?? "" };
}
