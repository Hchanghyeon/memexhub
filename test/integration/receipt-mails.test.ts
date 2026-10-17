import { beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { defineProvider } from "../../src/providers/types.js";
import { T } from "../../src/core/i18n.js";
import type { Mail, MailProvider } from "../../src/providers/mail/types.js";
import { testFs } from "../helpers.js";

/** In-memory read-only mailbox. */
const box: Mail[] = [];
let reads = 0;
const fakeMail: MailProvider = {
  async folders() { return ["Payments"]; },
  async search(q) { return box.filter((m) => m.folder === q.folder && m.date.slice(0, 10) >= q.since).map(({ uid, folder, date, from, subject }) => ({ uid, folder, date, from, subject })); },
  async read(folder, uid) { reads++; return box.find((m) => m.folder === folder && m.uid === uid)!; },
  digestFolders: () => [],
};
const mailProvider = defineProvider({ kind: "mail", id: "fake", title: T("fake", "fake"), config: z.object({}), runtimes: ["node"], create: () => fakeMail });
const add = (uid: string, subject: string, text: string, date = "2026-10-14 12:40") => box.push({ uid, folder: "Payments", date, from: "NHN KCP <noreply@kcp.example.com>", subject, text, to: "", attachments: [], truncated: false });

let hub: Hub;
const tool = (n: string) => hub.tools.find((t) => t.name === n)!;

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: mkdtempSync(join(tmpdir(), "mx-rm-")) });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => new Date("2026-10-15T03:00:00Z"), fetch, log: { ...jsonLogger, info() {} } }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-rv-"))), mailProvider]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.connections.upsert({ kind: "storage", provider: "fs", name: "vault", config: {} }, "t");
  await hub.connections.upsert({ kind: "mail", provider: "fake", name: "kakao", config: {} }, "t");
  const s = await hub.settings.get();
  await hub.settings.set("vault", { ...s.vault, connection: "vault" });
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.settings.set("ledger", { ...s.ledger, language: "ko", mailSources: [{ connection: "kakao", folder: "Payments" }] });
  await hub.settings.set("modules", { ledger: { enabled: true } });
  await hub.settings.set("recipePacks", ["kr.hyundai.sms", "kr.samsung.sms", "kr.kcp.mail", "kr.kicc.mail"]);
  await hub.reload();
});

describe("receipt mails", () => {
  it("attaches the item to the card payment, records the rest, and reads each mail once", async () => {
    const ledgerSms = hub.ingest.find((r) => r.path === "/ingest/message")!;
    await ledgerSms.handle({ channel: "sms", text: "[Web발신]\n현대카드 M 승인\n홍*동\n23,000원 일시불\n10/14 12:31\n샘플스토어\n누적 1원" }, { tokenId: "t" });
    add("101", "NHN KCP - 샘플스토어의 결제 안내", "결제일시 | 2026년 10월 14일 12시 30분 |\n구매상점명 | 샘플스토어 |\n주문상품명 | 샘플 텀블러 |\n결제금액 | 23,000원 |\n카드종류 | 현대카드 |\n할부기간 | 일시불 |");
    add("102", "NHN KCP - 샘플몰의 결제 안내", "결제일시 | 2026년 10월 14일 20시 05분 |\n구매상점명 | 샘플몰 |\n주문상품명 | 샘플 양말 |\n결제금액 | 9,900원 |\n카드종류 | 삼성카드 |\n할부기간 | 일시불 |");
    add("103", "샘플몰 주문 확인", "주문하신 상품 합계 15,000원 입니다");
    add("104", "뉴스레터", "이번 주 소식");
    add("105", "(광고) 가을 세일 최대 50%", "지금 구매하면 19,900원");
    add("106", "이번 주 할인 소식", "샘플 셔츠 29,000원 → 19,000원 · 지금 주문하세요\n수신거부");
    expect(await tool("payments_from_mail").run({}, { actor: "t" })).toBe("read 6 new mails: 1 recorded · 1 items attached · 1 to the inbox · 0 ignored · 3 not payments");
    const pay = (await hub.vault!.read("ledger/payments/2026.md")).text;
    expect(pay).toContain("샘플 텀블러");
    expect(pay).toMatch(/샘플몰.*₩9,900/);
    expect(pay.match(/₩23,000/g)!.length).toBe(1);
    const before = reads;
    expect(await tool("payments_from_mail").run({}, { actor: "t" })).toMatch(/^read 0 new mails/);
    expect(reads).toBe(before);
    expect(await tool("ledger_inbox").run({ limit: 20 }, { actor: "t" })).toContain("no recipe for this mail");
    // the older argument style (date + days) is accepted too
    expect(await tool("payments_from_mail").run({ date: "2026-10-14", days: 3 }, { actor: "t" })).toMatch(/^read 0 new mails/);
  });

  it("is a job only when folders are set, and reports a missing account", async () => {
    expect(hub.jobs.map((j) => j.job.id)).toContain("ledger-receipt-mails");
    const s = await hub.settings.get();
    await hub.settings.set("ledger", { ...s.ledger, mailSources: [{ connection: "nope", folder: "x" }] });
    await hub.reload();
    expect(await tool("payments_from_mail").run({}, { actor: "t" })).toContain("! nope: mail account not connected");
    await hub.settings.set("ledger", { ...s.ledger, mailSources: [] });
    await hub.reload();
    expect(hub.jobs.map((j) => j.job.id)).not.toContain("ledger-receipt-mails");
  });
});
