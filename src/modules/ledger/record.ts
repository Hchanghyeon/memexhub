import { z } from "zod";
import type { EventBus } from "../../core/events.js";

/** Optional: turns coordinates or a moment into a place name (location provider, P4). Coordinates are never stored. */
export interface PlaceResolver {
  nameAt?(lat: number, lon: number): Promise<string | undefined>;
  placeAt?(when: Date): Promise<string | undefined>;
}

const TRANSIT_WORDS = ["티머니", "t-money", "tmoney", "교통", "지하철", "버스", "코레일", "korail", "캐시비", "cashbee", "레일플러스", "rail+"];
/** Online / recurring merchants — the phone's location at payment time is not the place of purchase. */
const ONLINE_WORDS = [
  "쿠팡", "coupang", "네이버페이", "naver", "카카오페이", "kakao", "토스", "toss", "페이코", "payco", "11번가", "g마켓", "gmarket", "옥션", "ssg",
  "무신사", "29cm", "배달의민족", "배민", "요기요", "넷플릭스", "netflix", "유튜브", "youtube", "google", "구글", "apple", "애플", "앱스토어",
  "icloud", "스포티파이", "spotify", "디즈니", "disney", "티빙", "tving", "웨이브", "wavve", "왓챠", "멜론", "melon", "microsoft", "openai",
  "anthropic", "claude", "notion", "aws", "amazon", "아마존", "정기", "자동결제", "구독", "온라인", "인터넷", "해외", "paypal", "페이팔",
];
const LATE_S = 600;
const DEDUPE_MS = 5 * 60 * 1000;
const ATTACH_MS = 10 * 60 * 1000;

const field = z.string().max(200).optional().default("");
export const TransactionInput = z
  .object({
    merchant: field,
    amount: field,
    card: field,
    name: field,
    time: z.string().max(40).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lon: z.coerce.number().min(-180).max(180).optional(),
    kind: z.enum(["online", "taxi"]).optional(),
    item: field,
    source: z.string().max(20).optional(),
  })
  .strict();
export type TransactionInput = z.input<typeof TransactionInput>;

export interface LedgerPayload {
  merchant: string;
  amount: string;
  card: string;
  name: string;
  place: string;
  item: string;
  kind: string;
  transit: boolean;
  online: boolean;
  late: boolean;
  source: string;
}

/** Strip characters that could break note structure (newlines, wikilink brackets). */
const clean = (v: string | undefined) => (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/\[\[/g, "[").replace(/\]\]/g, "]").trim().slice(0, 200);
const digits = (s: string) => s.replace(/\D/g, "");

export function parseWhen(v: string | undefined, now: Date): Date {
  if (v) {
    const d = new Date(v.replace(/^(\d{4})\. (\d{1,2})\. (\d{1,2})\. /, "$1-$2-$3 "));
    if (!isNaN(+d)) return d;
  }
  return now;
}

export class Ledger {
  constructor(
    private bus: EventBus,
    private opts: { officePlaces: string[]; places?: PlaceResolver; now?: () => Date },
  ) {}

  private now() {
    return this.opts.now?.() ?? new Date();
  }

  /** Record one payment / tap. Returns what it became. */
  async record(input: TransactionInput): Promise<{ kind: "payment" | "transit" | "office"; duplicate: boolean; id: string }> {
    const raw = TransactionInput.parse(input);
    const t = { merchant: clean(raw.merchant), amount: clean(raw.amount), card: clean(raw.card), name: clean(raw.name) };
    if (!t.merchant && !t.amount && !t.card && !t.name) throw new Error("merchant, amount, card and name are all empty");
    const hay = `${t.merchant} ${t.card} ${t.name}`.toLowerCase();
    let transit = TRANSIT_WORDS.some((w) => hay.includes(w));
    // iOS sends no amount or merchant for transit taps — keep only the time.
    if (!t.merchant && !t.amount && !transit) t.amount = "금액 미상";
    const now = this.now();
    const when = parseWhen(raw.time, now);
    let place = "";
    try {
      if (raw.lat !== undefined && raw.lon !== undefined && (raw.lat || raw.lon)) place = clean(await this.opts.places?.nameAt?.(raw.lat, raw.lon));
      if (!place && transit && !t.merchant) place = clean(await this.opts.places?.placeAt?.(when));
    } catch {
      place = "";
    }
    const kind = raw.kind ?? "";
    const online = !transit && (kind === "online" || kind === "taxi" || (!!t.merchant && ONLINE_WORDS.some((w) => `${t.merchant} ${t.name}`.toLowerCase().includes(w))));
    const late = Math.abs(now.getTime() - when.getTime()) > LATE_S * 1000;
    const office = transit && !t.merchant && (!t.amount || t.amount.startsWith("요금")) && this.opts.officePlaces.includes(place);
    if (office) transit = false;

    const payload: LedgerPayload = { ...t, place, item: clean(raw.item), kind, transit, online, late, source: raw.source ?? "applepay" };
    const duplicate = !t.amount.startsWith("-") && (await this.isDuplicate(when, t.amount));
    const ev = await this.bus.append({ type: "ledger", occurredAt: when.toISOString(), source: payload.source, payload: payload as any, skipped: duplicate ? "duplicate" : null });
    return { kind: office ? "office" : transit ? "transit" : "payment", duplicate, id: ev.id };
  }

  /** Same amount within 5 minutes = the same payment reported twice (SMS + Apple Pay). */
  private async isDuplicate(when: Date, amount: string) {
    const d = digits(amount);
    if (!d) return false;
    const near = await this.bus.query(["ledger"], {
      from: new Date(when.getTime() - DEDUPE_MS).toISOString(),
      to: new Date(when.getTime() + DEDUPE_MS + 1).toISOString(),
    });
    return near.some((e) => digits(String((e.payload as any).amount ?? "")) === d);
  }

  /**
   * A receipt (recipe kind "item"): add its item name to the payment with the same amount within 10 minutes,
   * or record it as an online payment when the card message never arrived.
   */
  async attachOrRecord(input: TransactionInput): Promise<{ kind: "item" | "payment" | "transit" | "office"; duplicate: boolean; id: string }> {
    const raw = TransactionInput.parse(input);
    const when = parseWhen(raw.time, this.now());
    const d = digits(clean(raw.amount));
    const near = d
      ? (await this.bus.query(["ledger"], { from: new Date(when.getTime() - ATTACH_MS).toISOString(), to: new Date(when.getTime() + ATTACH_MS + 1).toISOString() })).filter(
          (e) => digits(String((e.payload as any).amount ?? "")) === d,
        )
      : [];
    if (near.length && raw.item) {
      await this.mergeItem(near[0]!.id, raw.item, raw.source ?? "mail");
      return { kind: "item", duplicate: false, id: near[0]!.id };
    }
    return this.record({ ...raw, kind: raw.kind ?? "online" });
  }

  /** Attach an item name (e.g. from a receipt mail) to an already-recorded payment. */
  async mergeItem(targetId: string, item: string, source = "mail") {
    await this.bus.append({ type: "ledger", occurredAt: new Date().toISOString(), source, payload: { target: targetId, item: clean(item) }, skipped: "merged" });
  }

  async reject(path: string, reason: string, keys: string[]) {
    // Values are never stored — only which keys were present.
    await this.bus.append({ type: "ledger.reject", occurredAt: new Date().toISOString(), source: path, payload: { reason: reason.slice(0, 200), keys: keys.slice(0, 20) }, skipped: "rejected" });
  }
}
