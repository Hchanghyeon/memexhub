import { beforeEach, describe, expect, it } from "vitest";
import { sqliteDb } from "../../src/platform/node.js";
import { migrate } from "../../src/core/migrations.js";
import { OAuthServer } from "../../src/auth/oauth.js";
import { AdminAuth } from "../../src/auth/admin.js";
import { IngestTokens } from "../../src/auth/ingest-tokens.js";
import { b64url, pkceS256, randomBytes } from "../../src/core/crypto.js";
import type { Db } from "../../src/platform/types.js";

let db: Db;
beforeEach(async () => {
  db = sqliteDb(":memory:");
  await migrate(db);
});

describe("OAuthServer", () => {
  const R = "https://claude.ai/api/mcp/auth_callback";
  const mk = () => new OAuthServer(db, "https://hub.example.com", async () => ["claude.ai", "claude.com"]);

  it("only registers https redirects on allowed hosts", async () => {
    const o = mk();
    await expect(o.register({ redirect_uris: ["https://evil.example.net/cb"] })).rejects.toMatchObject({ error: "invalid_redirect_uri" });
    await expect(o.register({ redirect_uris: ["http://claude.ai/cb"] })).rejects.toMatchObject({ error: "invalid_redirect_uri" });
    await expect(o.register({ redirect_uris: ["https://claude.ai.evil.net/cb"] })).rejects.toMatchObject({ error: "invalid_redirect_uri" });
    expect((await o.register({ redirect_uris: [R] })).client_id).toMatch(/^mxc_/);
  });

  it("requires PKCE S256 and exact redirect", async () => {
    const o = mk();
    const { client_id } = await o.register({ redirect_uris: [R] });
    await expect(o.validateAuthorize({ client_id, redirect_uri: R + "x", response_type: "code" })).rejects.toBeTruthy();
    await expect(o.validateAuthorize({ client_id, redirect_uri: R, response_type: "code", code_challenge: "x".repeat(43), code_challenge_method: "plain" })).rejects.toMatchObject({ error: "invalid_request" });
  });

  it("issues opaque tokens, rotates refresh, revokes family on reuse", async () => {
    const o = mk();
    const { client_id } = await o.register({ redirect_uris: [R] });
    const verifier = b64url(randomBytes(32));
    const v = await o.validateAuthorize({ client_id, redirect_uri: R, response_type: "code", code_challenge: await pkceS256(verifier), code_challenge_method: "S256" });
    const code = await o.issueCode(v, "adm_x");
    const t = await o.token({ grant_type: "authorization_code", code, client_id, redirect_uri: R, code_verifier: verifier });
    expect(await o.verifyAccess(t.access_token)).toEqual({ clientId: client_id });
    await expect(o.token({ grant_type: "authorization_code", code, client_id, redirect_uri: R, code_verifier: verifier })).rejects.toMatchObject({ error: "invalid_grant" });
    const t2 = await o.token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id });
    await expect(o.token({ grant_type: "refresh_token", refresh_token: t.refresh_token, client_id })).rejects.toMatchObject({ error: "invalid_grant" });
    expect(await o.verifyAccess(t2.access_token)).toBeNull();
    const raw = await db.all<{ token_hash: string }>(`SELECT token_hash FROM oauth_tokens`);
    expect(raw.every((r) => !r.token_hash.startsWith("mx"))).toBe(true); // only hashes at rest
  });
});

describe("AdminAuth", () => {
  it("setup code works once and dies after the admin is created", async () => {
    const a = new AdminAuth(db, "s".repeat(48));
    const code = await a.issueSetupCode();
    expect(await a.checkSetupCode("WRONG-CODE")).toBe(false);
    expect(await a.checkSetupCode(code.toLowerCase())).toBe(true);
    await a.createAdmin("owner", "long-enough-password", "test");
    expect(await a.checkSetupCode(code)).toBe(false);
  });
  it("rejects weak passwords and locks after repeated failures", async () => {
    const a = new AdminAuth(db, "s".repeat(48));
    await expect(a.createAdmin("owner", "short", "t")).rejects.toThrow();
    await a.createAdmin("owner", "long-enough-password", "t");
    for (let i = 0; i < 5; i++) expect(await a.login("owner", "wrong", undefined, "k")).toBeNull();
    expect(await a.login("owner", "long-enough-password", undefined, "k")).toBeNull(); // locked
    expect(await a.login("owner", "long-enough-password", undefined, "other")).toBeTruthy();
  });
});

describe("IngestTokens", () => {
  it("checks scope and revocation, stores only hashes", async () => {
    const t = new IngestTokens(db);
    const { id, token } = await t.create("phone", ["ledger"], "t");
    expect(await t.verify(token, "ledger")).toEqual({ id });
    expect(await t.verify(token, "health")).toBeNull();
    await t.revoke(id, "t");
    expect(await t.verify(token, "ledger")).toBeNull();
    expect(JSON.stringify(await db.all(`SELECT * FROM ingest_tokens`))).not.toContain(token);
  });
});
