import { nowIn } from "../../core/time.js";

/** One ledger event as the renderer sees it (payload + occurrence time). */
export interface LedgerRow {
  id?: string;
  time: string; // ISO with offset
  skipped?: string | null;
  target?: string; // for merges: event id, or legacy "time" ISO
  merchant?: string;
  amount?: string;
  card?: string;
  name?: string;
  place?: string;
  item?: string;
  kind?: string;
  transit?: boolean;
  online?: boolean;
  late?: boolean;
}

type Lang = "ko" | "en";
const S = {
  ko: {
    count: (n: number) => `${n}건`, cancel: (n: number) => `취소 ${n}`, noPayments: "결제 없음", dow: "월화수목금토일",
    head: ["시각", "어디서", "금액", "카드"], noMerchant: "가맹점 없음", tag: "태그", cancelled: "(취소)", cancelWord: " 취소",
    office1: (t: string) => `🏢 ${t} 출입`, officeN: (a: string, b: string, n: number) => `🏢 ${a} – ${b} · 출입 ${n}회`,
    title: (y: number) => `${y} 결제 기록`,
    intro: [
      "기기·자동화가 결제 순간 보낸 기록을 엔진이 날짜별로 정리한다 (카드 문자 · Apple Pay · 교통카드 · 결제 메일).",
      "합계는 원화 승인 − 취소. 빠짐없는 기준은 카드사 명세서. 🌐 온라인·정기 결제 · 🚕 택시 · 🚇 교통 태그 · 🏢 회사 출입.",
      "**이 노트는 엔진이 매번 다시 그린다 — 손으로 고치면 다음 기록 때 사라진다.**",
    ],
    m: {
      head: (t: string) => `## 자동 정리 — ${t} 기준\n`, none: "아직 원화 결제 기록이 없다.\n", month: (k: string) => `### 이번 달 (${k})\n`,
      total: (v: string, n: number) => `- **₩${v}** · ${n}건`,
      vsPrev: (pt: string, sign: string, d: string) => ` · 지난달 전체 ₩${pt} 대비 ${sign}₩${d} (이번 달은 아직 진행 중)`,
      perDay: (v: string, d: number) => `- 하루 평균 ₩${v} (기록 ${d}일)`, split: (a: string, b: string) => `- 현장 ₩${a} · 온라인·정기 ₩${b}`,
      top: "### 많이 쓴 곳 (이번 달)\n", topHead: "| 가맹점 | 합계 | 횟수 |", byCard: "카드별: ", unknownCard: "카드 미상",
      monthly: "### 월별\n", monthlyHead: "| 월 | 합계 | 건수 | 온라인·정기 |",
      recurring: "### 반복 결제 (구독·고정비 후보)\n",
      subs: "**구독·고정비** — 두 달 이상, 금액이 매달 거의 같은 결제\n", subsHead: "| 가맹점 | 금액 | 최근 결제 | 결제한 달 | 대략 매달 |",
      months: (n: number) => `${n}개월`, dayOf: (d: number) => `${d}일쯤`, times: (n: number) => `${n}회`,
      subsTotal: (v: string) => `카드로 나가는 구독·고정비 ≈ **₩${v} / 월** (+ 위 '수동 고정비')\n`,
      often: "**자주 가는 곳** — 두 달 이상 찍혔지만 금액이 매번 다름\n", oftenHead: "| 가맹점 | 최근 금액 | 최근 결제 | 결제한 달 | 횟수 |",
      tooEarly: (d: string) => `아직 판단할 수 없다 — 결제 기록이 ${d} 부터라 같은 곳이 두 달 이상 찍힌 결제가 없다. 다음 달부터 잡히기 시작한다.\n`,
      foot: "_원화 승인 − 취소 기준. 외화 결제·금액 없는 교통 태그는 뺀다._",
    },
  },
  en: {
    count: (n: number) => `${n} paid`, cancel: (n: number) => `${n} cancelled`, noPayments: "no payments", dow: "MTWTFSS",
    head: ["Time", "Where", "Amount", "Card"], noMerchant: "unknown merchant", tag: "tap", cancelled: "(cancelled)", cancelWord: " 취소",
    office1: (t: string) => `🏢 ${t} gate`, officeN: (a: string, b: string, n: number) => `🏢 ${a} – ${b} · ${n} gate taps`,
    title: (y: number) => `${y} payments`,
    intro: [
      "Records sent by your devices and automations at payment time, grouped by day by the engine (card SMS · Apple Pay · transit card · receipt mails).",
      "Totals are KRW approvals minus cancellations; your card statement is the complete source. 🌐 online/recurring · 🚕 taxi · 🚇 transit tap · 🏢 office gate.",
      "**The engine redraws this note on every record — manual edits will be lost.**",
    ],
    m: {
      head: (t: string) => `## Summary — as of ${t}\n`, none: "No KRW payments yet.\n", month: (k: string) => `### This month (${k})\n`,
      total: (v: string, n: number) => `- **₩${v}** · ${n} payments`,
      vsPrev: (pt: string, sign: string, d: string) => ` · last month ₩${pt}, ${sign}₩${d} (month in progress)`,
      perDay: (v: string, d: number) => `- ₩${v} per day (${d} days recorded)`, split: (a: string, b: string) => `- in person ₩${a} · online/recurring ₩${b}`,
      top: "### Top merchants (this month)\n", topHead: "| Merchant | Total | Count |", byCard: "By card: ", unknownCard: "unknown card",
      monthly: "### By month\n", monthlyHead: "| Month | Total | Count | Online/recurring |",
      recurring: "### Recurring payments\n",
      subs: "**Subscriptions & fixed costs** — two or more months, nearly the same amount\n", subsHead: "| Merchant | Amount | Last | Months | Day of month |",
      months: (n: number) => `${n} months`, dayOf: (d: number) => `~${d}`, times: (n: number) => `${n}×`,
      subsTotal: (v: string) => `Card-paid subscriptions & fixed costs ≈ **₩${v} / month** (+ manual fixed costs above)\n`,
      often: "**Frequent places** — two or more months, varying amounts\n", oftenHead: "| Merchant | Last amount | Last | Months | Count |",
      tooEarly: (d: string) => `Too early to tell — records start ${d}; nothing has repeated across two months yet.\n`,
      foot: "_KRW approvals minus cancellations. Foreign-currency payments and transit taps without amounts are excluded._",
    },
  },
} as const;

const fmt = (n: number) => n.toLocaleString("en-US");
const pad = (n: number) => String(n).padStart(2, "0");
const digits = (s = "") => s.replace(/\D/g, "");
export const cell = (s = "") => s.replace(/\|/g, "／").trim();
export const shortPlace = (p = "") => (p.trim().includes(" ") ? p.trim().split(/\s+/).pop()! : p.trim());
export const normMerchant = (s = "") => s.toLowerCase().replace(/[\s()（）\[\]·.,*_-]+/g, "");
export function krw(amount = ""): number | null {
  const a = amount.replace(/ /g, "");
  const m = a.match(/^(-)?₩([\d,]+)$/) ?? a.match(/^(-)?([\d,]+)원$/);
  if (!m) return null;
  const v = Number(m[2]!.replace(/,/g, ""));
  return m[1] ? -v : v;
}

type Kind = "pay" | "transit" | "office";
const TRANSIT = ["티머니", "t-money", "tmoney", "교통", "지하철", "버스", "코레일", "korail", "캐시비", "cashbee", "레일플러스", "rail+"];
export function classify(r: LedgerRow, officePlaces: string[]): Kind {
  const tagish = !r.merchant && (!r.amount || r.amount.startsWith("요금"));
  if (tagish && officePlaces.includes(r.place ?? "")) return "office";
  const hay = `${r.merchant ?? ""} ${r.card ?? ""} ${r.name ?? ""}`.toLowerCase();
  if (tagish && (r.transit || TRANSIT.some((w) => hay.includes(w)))) return "transit";
  return "pay";
}

export interface Ent extends LedgerRow {
  w: ReturnType<typeof nowIn>;
  ms: number;
  kind2: Kind;
}

export function entries(rows: LedgerRow[], tz: string, officePlaces: string[]): Ent[] {
  const items = new Map<string, string>();
  for (const r of rows) if (r.skipped === "merged" && r.target) items.set(r.amount ? `${r.target}|${digits(r.amount)}` : r.target, r.item ?? "");
  const out: Ent[] = [];
  for (const r of rows) {
    if (r.skipped) continue;
    const ms = Date.parse(r.time);
    if (isNaN(ms)) continue;
    const e: Ent = { ...r, w: nowIn(tz, new Date(ms)), ms, kind2: classify(r, officePlaces) };
    const it = items.get(`${r.time}|${digits(r.amount)}`) ?? (r.id ? items.get(r.id) : undefined);
    if (it) e.item = it;
    out.push(e);
  }
  return out.sort((a, b) => a.ms - b.ms);
}

const dowOf = (y: number, m: number, d: number, lang: Lang) => S[lang].dow[(new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7];

/** The yearly payments note body (from the first month heading on). */
export function renderPaymentsBody(rows: LedgerRow[], year: number, o: { tz: string; officePlaces: string[]; lang: Lang }): string {
  const t = S[o.lang];
  const ents = entries(rows, o.tz, o.officePlaces).filter((e) => e.w.y === year);
  const summary = (es: Ent[]) => {
    const pays = es.filter((e) => e.kind2 === "pay");
    const n = pays.filter((e) => !(e.amount ?? "").startsWith("-")).length;
    const cancel = pays.length - n;
    const won = pays.reduce((s, e) => s + (krw(e.amount) ?? 0), 0);
    return [n ? t.count(n) : "", won ? `₩${fmt(won)}` : "", cancel ? t.cancel(cancel) : ""].filter(Boolean).join(" · ");
  };
  const out: string[] = [];
  const months = new Map<string, Ent[]>();
  for (const e of ents) {
    const k = `${e.w.y}-${pad(e.w.m)}`;
    months.set(k, [...(months.get(k) ?? []), e]);
  }
  for (const [mk, mes] of months) {
    const s = summary(mes);
    out.push(`## ${mk}` + (s ? ` — ${s}` : "") + "\n");
    const days = new Map<string, Ent[]>();
    for (const e of mes) days.set(`${pad(e.w.m)}-${pad(e.w.d)}`, [...(days.get(`${pad(e.w.m)}-${pad(e.w.d)}`) ?? []), e]);
    for (const [dk, des] of days) {
      const s2 = summary(des);
      const f = des[0]!.w;
      out.push(`### ${dk} (${dowOf(f.y, f.m, f.d, o.lang)})` + (s2 ? ` — ${s2}` : ` — ${t.noPayments}`) + "\n");
      const pays = des.filter((e) => e.kind2 === "pay");
      if (pays.length) {
        out.push(`| ${t.head.join(" | ")} |`, "|---|---|---|---|");
        for (const e of pays) {
          const who = e.merchant || e.name || t.noMerchant;
          const icon = e.kind === "taxi" ? "🚕 " : e.online ? "🌐 " : e.transit ? "🚇 " : "";
          const it = e.item ?? "";
          let where = icon + who + (it && !who.replace(/ /g, "").includes(it.replace(/ /g, "")) ? ` · ${it}` : "");
          const place = e.online || (e.late && !e.transit) ? "" : e.place ?? "";
          if (place) where += ` @ ${shortPlace(place)}`;
          const amt = e.amount ?? "";
          let card = e.card ?? "";
          if (amt.startsWith("-")) card = card ? card.replace(t.cancelWord, "") + ` ${t.cancelled}` : t.cancelled;
          out.push(`| ${pad(e.w.h)}:${pad(e.w.mi)} | ${cell(where)} | ${cell(amt)} | ${cell(card)} |`);
        }
        out.push("");
      }
      const tr = des.filter((e) => e.kind2 === "transit");
      if (tr.length) out.push("🚇 " + tr.map((e) => `${pad(e.w.h)}:${pad(e.w.mi)} ${shortPlace(e.place) || t.tag}`).join(" → "));
      const of = des.filter((e) => e.kind2 === "office");
      if (of.length === 1) out.push(t.office1(`${pad(of[0]!.w.h)}:${pad(of[0]!.w.mi)}`));
      else if (of.length > 1) out.push(t.officeN(`${pad(of[0]!.w.h)}:${pad(of[0]!.w.mi)}`, `${pad(of.at(-1)!.w.h)}:${pad(of.at(-1)!.w.mi)}`, of.length));
      if (tr.length || of.length) out.push("");
    }
  }
  return out.join("\n").replace(/\n+$/, "") + "\n";
}

export function renderPaymentsNote(rows: LedgerRow[], year: number, o: { tz: string; officePlaces: string[]; lang: Lang; now: Date }): string {
  const t = S[o.lang];
  const today = (d: Date) => { const p = nowIn(o.tz, d); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
  const first = entries(rows, o.tz, o.officePlaces).find((e) => e.w.y === year);
  const created = first ? `${first.w.y}-${pad(first.w.m)}-${pad(first.w.d)}` : today(o.now);
  return `---\ntitle: ${t.title(year)}\ncreated: ${created}\nupdated: ${today(o.now)}\ntype: note\ntags: []\n---\n\n# ${t.title(year)}\n\n${t.intro.join("\n")}\n\n` + renderPaymentsBody(rows, year, o);
}

/** The auto section of the money note. */
export function renderMoney(rows: LedgerRow[], o: { tz: string; officePlaces: string[]; lang: Lang; now: Date }): string {
  const t = S[o.lang].m;
  const pays = entries(rows, o.tz, o.officePlaces)
    .filter((e) => e.kind2 === "pay" && krw(e.amount) !== null)
    .map((e) => ({ w: e.w, ms: e.ms, v: krw(e.amount)!, who: e.merchant || e.name || S[o.lang].noMerchant, card: (e.card ?? "").replace(/\s*(일시불|취소|\d+개월.*)$/, "").trim() || t.unknownCard, online: !!e.online }));
  const now = nowIn(o.tz, o.now);
  const out = [t.head(`${now.y}-${pad(now.m)}-${pad(now.d)} ${pad(now.h)}:${pad(now.mi)}`)];
  if (!pays.length) return [...out, t.none].join("\n");
  const firstMs = Math.min(...pays.map((p) => p.ms));
  const first = nowIn(o.tz, new Date(firstMs));
  const monthKey = (w: { y: number; m: number }) => `${w.y}-${pad(w.m)}`;
  const months = new Map<string, typeof pays>();
  for (const p of pays) months.set(monthKey(p.w), [...(months.get(monthKey(p.w)) ?? []), p]);
  const keys = [...months.keys()].sort();
  const cur = monthKey(now);
  const cm = months.get(cur) ?? [];
  const tot = cm.reduce((s, p) => s + p.v, 0);
  const n = cm.filter((p) => p.v > 0).length;
  out.push(t.month(cur));
  let line = t.total(fmt(tot), n);
  const ci = keys.indexOf(cur);
  if (ci > 0) {
    const pt = months.get(keys[ci - 1]!)!.reduce((s, p) => s + p.v, 0);
    const diff = tot - pt;
    line += t.vsPrev(fmt(pt), diff >= 0 ? "+" : "−", fmt(Math.abs(diff)));
  }
  out.push(line);
  const dayNum = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86_400_000;
  const startDay = Math.max(dayNum(first.y, first.m, first.d), dayNum(now.y, now.m, 1));
  const days = dayNum(now.y, now.m, now.d) - startDay + 1;
  if (days > 0 && tot) out.push(t.perDay(fmt(Math.floor(tot / days)), days));
  const off = cm.filter((p) => !p.online).reduce((s, p) => s + p.v, 0);
  const on = cm.filter((p) => p.online).reduce((s, p) => s + p.v, 0);
  if (on) out.push(t.split(fmt(off), fmt(on)));
  out.push("");
  if (cm.length) {
    const by = new Map<string, { who: string; v: number; n: number }>();
    for (const p of cm) {
      const k = normMerchant(p.who);
      const e = by.get(k) ?? { who: p.who, v: 0, n: 0 };
      e.v += p.v;
      e.n += p.v > 0 ? 1 : 0;
      by.set(k, e);
    }
    const top = [...by.values()].filter((e) => e.v > 0).sort((a, b) => b.v - a.v).slice(0, 5);
    out.push(t.top, t.topHead, "|---|---|---|", ...top.map((e) => `| ${cell(e.who)} | ₩${fmt(e.v)} | ${e.n} |`), "");
    const cards = new Map<string, number>();
    for (const p of cm) cards.set(p.card, (cards.get(p.card) ?? 0) + p.v);
    out.push(t.byCard + [...cards].sort((a, b) => b[1] - a[1]).map(([c, v]) => `${cell(c)} ₩${fmt(v)}`).join(" · ") + "\n");
  }
  out.push(t.monthly, t.monthlyHead, "|---|---|---|---|");
  for (const k of [...keys].reverse()) {
    const ms = months.get(k)!;
    out.push(`| ${k} | ₩${fmt(ms.reduce((s, p) => s + p.v, 0))} | ${ms.filter((p) => p.v > 0).length} | ₩${fmt(ms.filter((p) => p.online).reduce((s, p) => s + p.v, 0))} |`);
  }
  out.push("", t.recurring);
  const groups = new Map<string, typeof pays>();
  for (const p of pays) if (p.v > 0) groups.set(normMerchant(p.who), [...(groups.get(normMerchant(p.who)) ?? []), p]);
  type Rec = [(typeof pays)[number], number, number, number];
  const subs: Rec[] = [];
  const often: Rec[] = [];
  for (const g of groups.values()) {
    const ms = [...new Set(g.map((p) => monthKey(p.w)))].sort();
    if (ms.length < 2) continue;
    const last = g.reduce((a, b) => (b.ms > a.ms ? b : a));
    const dom = g.map((p) => p.w.d).sort((a, b) => a - b);
    const vs = g.map((p) => p.v);
    const steady = Math.max(...vs) <= Math.min(...vs) * 1.1 && g.length <= ms.length + 1;
    (steady ? subs : often).push([last, ms.length, dom[Math.floor(dom.length / 2)]!, g.length]);
  }
  const md = (w: { m: number; d: number }) => `${pad(w.m)}-${pad(w.d)}`;
  if (subs.length || often.length) {
    if (subs.length) {
      out.push(t.subs, t.subsHead, "|---|---|---|---|---|");
      for (const [last, nm, d] of [...subs].sort((a, b) => b[0].v - a[0].v)) out.push(`| ${cell(last.who)} | ₩${fmt(last.v)} | ${md(last.w)} | ${t.months(nm)} | ${t.dayOf(d)} |`);
      out.push("", t.subsTotal(fmt(subs.reduce((s, x) => s + x[0].v, 0))));
    }
    if (often.length) {
      out.push(t.often, t.oftenHead, "|---|---|---|---|---|");
      for (const [last, nm, , cnt] of [...often].sort((a, b) => b[3] - a[3])) out.push(`| ${cell(last.who)} | ₩${fmt(last.v)} | ${md(last.w)} | ${t.months(nm)} | ${t.times(cnt)} |`);
      out.push("");
    }
  } else out.push(t.tooEarly(md(first)));
  out.push(t.foot);
  return out.join("\n");
}

/** Skeleton for a new money note; only the auto section is ever rewritten. */
export function moneySkeleton(lang: Lang, paymentsLink: string, today: string): string {
  const ko = lang === "ko";
  return [
    `---\ntitle: ${ko ? "돈" : "Money"}\ncreated: ${today}\nupdated: ${today}\ntype: note\ntags: []\n---\n`,
    `# ${ko ? "돈" : "Money"}\n`,
    ko
      ? `월 지출 · 많이 쓴 곳 · 구독·고정비. 결제 기록(${paymentsLink})에서 엔진이 자동으로 계산한다.\n카드 문자·Apple Pay·결제 메일로 들어온 것만 잡힌다 — **계좌 자동이체와 문자 알림 없는 카드는 빠진다.** 그런 건 아래 '수동 고정비' 에 직접 적는다.\n`
      : `Monthly spending, top merchants, subscriptions — computed by the engine from ${paymentsLink}.\nOnly card SMS, Apple Pay and receipt mails are seen — **bank transfers and cards without SMS alerts are missing.** Add those under "Manual fixed costs".\n`,
    ko ? "## 수동 고정비 (직접 적기)\n\n| 항목 | 금액 | 언제·어떻게 | 메모 |\n|---|---|---|---|\n" : "## Manual fixed costs\n\n| Item | Amount | When / how | Note |\n|---|---|---|---|\n",
    ko ? "## 메모\n\n" : "## Notes\n\n",
    `${AUTO_START}\n${AUTO_END}\n`,
  ].join("\n");
}

export const AUTO_START = "<!-- memexhub:auto id=money -->";
export const AUTO_END = "<!-- /memexhub:auto -->";

/** Replace only the auto section; everything humans wrote stays. */
export function replaceAutoSection(text: string, body: string): string {
  if (!text.includes(AUTO_START) || !text.includes(AUTO_END)) text = text.replace(/\n*$/, "") + `\n\n${AUTO_START}\n${AUTO_END}\n`;
  const a = text.indexOf(AUTO_START) + AUTO_START.length;
  const b = text.indexOf(AUTO_END);
  return text.slice(0, a) + "\n" + body + "\n" + text.slice(b);
}
