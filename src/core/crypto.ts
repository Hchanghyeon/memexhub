/**
 * Crypto helpers built only on WebCrypto, so they run on Node and Cloudflare Workers alike.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtle = globalThis.crypto.subtle;

export function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  globalThis.crypto.getRandomValues(b);
  return b;
}

/** 256-bit random token, URL-safe. */
export function randomToken(prefix = ""): string {
  return prefix + b64url(randomBytes(32));
}

export async function sha256Hex(s: string): Promise<string> {
  const d = new Uint8Array(await subtle.digest("SHA-256", enc.encode(s)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i % (ab.length || 1)] ?? 0) ^ (bb[i % (bb.length || 1)] ?? 0);
  return diff === 0;
}

async function hkdfKey(secret: string, purpose: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await subtle.importKey("raw", enc.encode(secret), "HKDF", false, ["deriveKey"]);
  return subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: enc.encode("memexhub/v1"), info: enc.encode(purpose) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    usage,
  );
}

/**
 * AES-256-GCM. `aad` binds the ciphertext to its record (e.g. connection id) so values cannot be swapped.
 * Output: "v1.<iv>.<ciphertext>" (base64url).
 */
export async function encrypt(secret: string, purpose: string, plaintext: string, aad: string): Promise<string> {
  const key = await hkdfKey(secret, purpose, ["encrypt"]);
  const iv = randomBytes(12);
  const ct = new Uint8Array(
    await subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc.encode(aad) }, key, enc.encode(plaintext)),
  );
  return `v1.${b64url(iv)}.${b64url(ct)}`;
}

export async function decrypt(secret: string, purpose: string, blob: string, aad: string): Promise<string> {
  const [v, iv, ct] = blob.split(".");
  if (v !== "v1" || !iv || !ct) throw new Error("unsupported ciphertext");
  const key = await hkdfKey(secret, purpose, ["decrypt"]);
  const pt = await subtle.decrypt(
    { name: "AES-GCM", iv: fromB64url(iv), additionalData: enc.encode(aad) },
    key,
    fromB64url(ct),
  );
  return dec.decode(pt);
}

const PBKDF2_ITER = 600_000;

/** PBKDF2-HMAC-SHA256, 600k iterations (OWASP). Format: "pbkdf2$<iter>$<salt>$<hash>". */
export async function hashPassword(password: string, iterations = PBKDF2_ITER): Promise<string> {
  const salt = randomBytes(16);
  const h = await pbkdf2(password, salt, iterations);
  return `pbkdf2$${iterations}$${b64url(salt)}$${b64url(h)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, iter, salt, hash] = stored.split("$");
  if (alg !== "pbkdf2" || !iter || !salt || !hash) return false;
  const h = await pbkdf2(password, fromB64url(salt), Number(iter));
  return safeEqual(b64url(h), hash);
}

async function pbkdf2(password: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<Uint8Array> {
  const key = await subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256));
}

/** RFC 7636 S256 code challenge. */
export async function pkceS256(verifier: string): Promise<string> {
  return b64url(new Uint8Array(await subtle.digest("SHA-256", enc.encode(verifier))));
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) — for authenticator apps. */
export async function totp(secretB32: string, at: number, step = 30): Promise<string> {
  const key = await subtle.importKey("raw", base32Decode(secretB32), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const counter = Math.floor(at / 1000 / step);
  const msg = new Uint8Array(8);
  new DataView(msg.buffer).setUint32(4, counter);
  new DataView(msg.buffer).setUint32(0, Math.floor(counter / 2 ** 32));
  const mac = new Uint8Array(await subtle.sign("HMAC", key, msg));
  const off = mac[mac.length - 1]! & 0xf;
  const bin = ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(bin % 1_000_000).padStart(6, "0");
}

export async function verifyTotp(secretB32: string, code: string, now: number): Promise<boolean> {
  for (const drift of [-1, 0, 1]) {
    if (safeEqual(await totp(secretB32, now + drift * 30_000), code.trim())) return true;
  }
  return false;
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string): Uint8Array<ArrayBuffer> {
  const clean = s.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of clean) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("bad base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
