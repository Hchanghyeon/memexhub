import { describe, expect, it } from "vitest";
import { decrypt, encrypt, hashPassword, pkceS256, totp, verifyPassword, safeEqual } from "../../src/core/crypto.js";

const SECRET = "x".repeat(48);

describe("crypto", () => {
  it("round-trips AES-GCM and binds to AAD", async () => {
    const blob = await encrypt(SECRET, "connections", "hunter2", "con_1");
    expect(blob).not.toContain("hunter2");
    expect(await decrypt(SECRET, "connections", blob, "con_1")).toBe("hunter2");
    await expect(decrypt(SECRET, "connections", blob, "con_2")).rejects.toThrow();
    await expect(decrypt(SECRET, "other-purpose", blob, "con_1")).rejects.toThrow();
    await expect(decrypt("y".repeat(48), "connections", blob, "con_1")).rejects.toThrow();
  });

  it("hashes passwords with PBKDF2", async () => {
    const h = await hashPassword("correct horse battery", 1000);
    expect(await verifyPassword("correct horse battery", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("matches RFC 7636 PKCE example", async () => {
    expect(await pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("matches RFC 6238 TOTP vector (SHA-1, T=59)", async () => {
    // secret "12345678901234567890" in base32
    expect(await totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
  });

  it("compares in constant time", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
