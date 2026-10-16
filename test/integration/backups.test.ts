import { beforeAll, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Hub } from "../../src/hub.js";
import { MODULES } from "../../src/modules/index.js";
import { sqliteDb, jsonLogger, fileBackups } from "../../src/platform/node.js";
import { loadEnv } from "../../src/core/config.js";
import { exportBackup, importBackup } from "../../src/core/backup.js";
import { adminClient } from "../admin-client.js";
import { testFs } from "../helpers.js";

const dataDir = mkdtempSync(join(tmpdir(), "mx-bk-"));
let hub: Hub, a: ReturnType<typeof adminClient>;
let now = new Date("2026-10-15T03:00:00Z");
const BASE = "http://10.0.0.2";

beforeAll(async () => {
  const env = loadEnv({ MEMEXHUB_SECRET: "k".repeat(48), PUBLIC_URL: "https://hub.example.com", DATA_DIR: dataDir });
  hub = new Hub({ name: "node", db: sqliteDb(":memory:"), secret: env.MEMEXHUB_SECRET, now: () => now, fetch, log: { ...jsonLogger, info() {} }, backups: fileBackups(join(dataDir, "backups")) }, env, MODULES, [testFs(mkdtempSync(join(tmpdir(), "mx-bkv-")))]);
  const log = console.log;
  console.log = () => {};
  await hub.init();
  console.log = log;
  await hub.admin.createAdmin("owner", "a-long-test-password", "t");
  await hub.connections.upsert({ kind: "mail", provider: "imap", name: "personal", config: { username: "someone" }, secrets: { password: "app-pass" } }, "t");
  await hub.settings.set("timezone", "Asia/Seoul");
  await hub.bus.append({ type: "ledger", occurredAt: now.toISOString(), source: "t", payload: { merchant: "Sample Cafe", amount: "₩4,500" } as any });
  a = adminClient(hub);
  await a.login();
});

describe("backups", () => {
  it("round-trips encrypted, refuses other secrets, damage and newer schemas", async () => {
    const blob = await exportBackup(hub.platform.db, hub.platform.secret, now);
    expect(blob).not.toContain("Sample Cafe");
    expect(blob).not.toContain("app-pass");
    await hub.settings.set("timezone", "UTC");
    await hub.bus.append({ type: "ledger", occurredAt: now.toISOString(), source: "t", payload: { merchant: "Later" } as any });
    const r = await importBackup(hub.platform.db, hub.platform.secret, blob);
    await hub.reload();
    expect(r.rows).toBeGreaterThan(3);
    expect((await hub.settings.get()).timezone).toBe("Asia/Seoul");
    expect(JSON.stringify(await hub.bus.query(["ledger"]))).not.toContain("Later");
    expect((await hub.connections.secretsOf((await hub.connections.get("mail", "personal"))!.id)).password).toBe("app-pass");
    await expect(importBackup(hub.platform.db, "x".repeat(48), blob)).rejects.toThrow(/different MEMEXHUB_SECRET/);
    await expect(importBackup(hub.platform.db, hub.platform.secret, blob.replace(/.{8}\n$/, "AAAAAAAA\n"))).rejects.toThrow(/cannot decrypt/);
    await expect(importBackup(hub.platform.db, hub.platform.secret, "hello")).rejects.toThrow(/not a memexhub backup/);
  });

  it("daily job writes private files, skips when recent, keeps 14", async () => {
    const job = hub.jobs.find((j) => j.job.id === "daily-backup")!.job;
    await job.run();
    await job.run(); // < 20 h later → skipped
    const dir = join(dataDir, "backups");
    expect(readdirSync(dir).length).toBe(1);
    expect((statSync(dir).mode & 0o777).toString(8)).toBe("700");
    expect((statSync(join(dir, readdirSync(dir)[0]!)).mode & 0o777).toString(8)).toBe("600");
    for (let i = 1; i <= 15; i++) {
      now = new Date(Date.parse("2026-10-15T03:00:00Z") + i * 86_400_000);
      await job.run();
    }
    expect(readdirSync(dir).length).toBe(14);
    await expect(fileBackups(dir).read("../memexhub.db")).rejects.toThrow(/invalid backup name/);
  });

  it("admin: download, restore needs the word RESTORE, activity log filters", async () => {
    const dl = await a.post("/backups/download");
    expect(dl.headers.get("content-disposition")).toMatch(/attachment; filename="memexhub-\d{4}-\d{2}-\d{2}\.mxb"/);
    const blob = await dl.text();
    expect((await (await a.upload("/backups/restore", "b.mxb", blob, { confirm: "yes" })).json()).error).toBe("type_restore");
    const ok = await (await a.upload("/backups/restore", "b.mxb", blob, { confirm: "RESTORE" })).json();
    expect(ok.rows).toBeGreaterThan(0);
    await a.login(); // the restore replaced the sessions table
    const rows = (await a.json("/activity?view=changes&who=admin&days=30")).rows.map((r: { action: string }) => r.action);
    expect(rows).toContain("backup.restore");
    expect(rows).toContain("backup.download");
    expect((await a.json("/security")).checks.map((c: { id: string }) => c.id)).toContain("backup_recent");
  });
});
