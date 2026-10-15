import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bootEnv } from "../../src/platform/env-sources.js";
import { loadEnv } from "../../src/core/config.js";

describe("boot environment", () => {
  it("reads Home Assistant add-on options; real variables win", () => {
    const f = join(mkdtempSync(join(tmpdir(), "mx-ha-")), "options.json");
    writeFileSync(f, JSON.stringify({ memexhub_secret: "s".repeat(48), public_url: "https://ha.example.com", timezone: "Asia/Seoul", admin_public: "" }));
    const e = loadEnv(bootEnv({ TZ: "UTC" }, f));
    expect([e.MEMEXHUB_SECRET.length, e.PUBLIC_URL, e.TZ, e.ADMIN_PUBLIC]).toEqual([48, "https://ha.example.com", "UTC", false]);
  });
  it("one PORT → a single listener on it (Railway, Render)", () => {
    const e = loadEnv(bootEnv({ MEMEXHUB_SECRET: "s".repeat(48), PUBLIC_URL: "https://app.example.com", PORT: "4321", ADMIN_PUBLIC: "1" }, "/nope"));
    expect([e.LISTEN, e.SINGLE_PORT, e.ADMIN_PUBLIC]).toEqual(["single", 4321, true]);
    expect(loadEnv(bootEnv({ MEMEXHUB_SECRET: "s".repeat(48), PUBLIC_URL: "https://a.example.com" }, "/nope")).LISTEN).toBe("split");
  });
});
