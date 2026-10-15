/** Minimal MIME reader (RFC 2045-2047, 2231) on web standards — enough for reading mail as text. */
const ALIAS: Record<string, string> = { "ks_c_5601-1987": "euc-kr", cp949: "euc-kr", "x-windows-949": "euc-kr", "unicode-1-1-utf-7": "utf-8" };

export function decodeBytes(bytes: Uint8Array, charset?: string): string {
  const cs = (charset ?? "").toLowerCase().trim();
  if (cs) {
    try {
      return new TextDecoder(ALIAS[cs] ?? cs).decode(bytes);
    } catch {
      /* unknown charset — fall through */
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes); // common legacy Korean
  }
}

const latin1 = (b: Uint8Array) => {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return s;
};
const bytesOf = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

export function decodeBase64(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/=]/g, "");
  try {
    return bytesOf(atob(clean.slice(0, clean.length - (clean.length % 4)) || ""));
  } catch {
    return new Uint8Array();
  }
}

export function decodeQP(s: string, header = false): Uint8Array {
  const src = header ? s.replace(/_/g, " ") : s.replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === "=" && /^[0-9A-Fa-f]{2}$/.test(src.slice(i + 1, i + 3))) {
      out.push(parseInt(src.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(c.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(out);
}

/** RFC 2047 encoded words; adjacent words separated only by whitespace are joined. */
export function decodeWords(s: string): string {
  return s
    .replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, "$1")
    .replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs: string, enc: string, data: string) =>
      decodeBytes(enc.toUpperCase() === "B" ? decodeBase64(data) : decodeQP(data, true), cs.split("*")[0]),
    )
    .replace(/\s+/g, " ")
    .trim();
}

export interface Part {
  headers: Map<string, string>; // lower-case names, raw (latin1) values
  body: Uint8Array;
}

function indexOfSeq(hay: Uint8Array, needle: Uint8Array, from = 0) {
  outer: for (let i = from; i <= hay.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}

export function splitPart(raw: Uint8Array): Part {
  let sep = indexOfSeq(raw, bytesOf("\r\n\r\n"));
  let skip = 4;
  if (sep < 0) {
    sep = indexOfSeq(raw, bytesOf("\n\n"));
    skip = 2;
  }
  const head = latin1(sep < 0 ? raw : raw.subarray(0, sep)).replace(/\r?\n[ \t]+/g, " ");
  const headers = new Map<string, string>();
  for (const line of head.split(/\r?\n/)) {
    const m = line.match(/^([!-9;-~]+):\s*(.*)$/);
    if (m && !headers.has(m[1]!.toLowerCase())) headers.set(m[1]!.toLowerCase(), m[2]!);
  }
  return { headers, body: sep < 0 ? new Uint8Array() : raw.subarray(sep + skip) };
}

/** Header value as text: raw 8-bit bytes (UTF-8 or EUC-KR) and RFC 2047 words both decoded. */
export function headerText(raw: string | undefined): string {
  if (!raw) return "";
  return decodeWords(decodeBytes(bytesOf(raw)));
}

export function params(value: string | undefined): { value: string; params: Record<string, string> } {
  const [v, ...rest] = (value ?? "").split(";");
  const p: Record<string, string> = {};
  const ext: Record<string, string[]> = {};
  for (const r of rest) {
    const m = r.match(/^\s*([^=\s]+)\s*=\s*"?([^"]*)"?\s*$/);
    if (!m) continue;
    const k = m[1]!.toLowerCase();
    const star = k.match(/^(.+?)\*(\d*)\*?$/);
    if (star) (ext[star[1]!] ??= [])[Number(star[2] || 0)] = m[2]!;
    else p[k] = decodeWords(decodeBytes(bytesOf(m[2]!))); // raw 8-bit or RFC 2047 values
  }
  for (const [k, parts] of Object.entries(ext)) {
    // RFC 2231: charset'lang'percent-encoded
    const joined = parts.join("");
    const mm = joined.match(/^([^']*)'[^']*'(.*)$/);
    if (mm) p[k] = decodeBytes(Uint8Array.from((mm[2]!.match(/%[0-9A-Fa-f]{2}|[^%]/g) ?? []).map((t) => (t.startsWith("%") ? parseInt(t.slice(1), 16) : t.charCodeAt(0)))), mm[1]);
    else p[k] = joined;
  }
  return { value: (v ?? "").trim().toLowerCase(), params: p };
}

function transferDecode(p: Part): Uint8Array {
  const enc = (p.headers.get("content-transfer-encoding") ?? "").toLowerCase().trim();
  if (enc === "base64") return decodeBase64(latin1(p.body));
  if (enc === "quoted-printable") return decodeQP(latin1(p.body));
  return p.body;
}

export interface Extracted {
  plain: string[];
  html: string[];
  attachments: string[];
}

/** Walk a message: collect text/plain, text/html and attachment names. Depth- and count-limited. */
export function extract(raw: Uint8Array, depth = 0, acc: Extracted = { plain: [], html: [], attachments: [] }): Extracted {
  const part = splitPart(raw);
  const ct = params(part.headers.get("content-type") ?? "text/plain");
  const cd = params(part.headers.get("content-disposition"));
  const name = cd.params.filename ?? ct.params.name;
  if (ct.value.startsWith("multipart/") && ct.params.boundary && depth < 8) {
    const b = bytesOf("--" + ct.params.boundary);
    let i = indexOfSeq(part.body, b);
    let n = 0;
    while (i >= 0 && n++ < 100) {
      const start = i + b.length;
      if (part.body[start] === 45 && part.body[start + 1] === 45) break; // closing "--"
      const next = indexOfSeq(part.body, b, start);
      const chunk = part.body.subarray(start, next < 0 ? part.body.length : next);
      extract(chunk.subarray(chunk[0] === 13 ? 2 : chunk[0] === 10 ? 1 : 0), depth + 1, acc);
      i = next;
    }
    return acc;
  }
  if (name || cd.value === "attachment") {
    acc.attachments.push(name || "(unnamed)"); // already decoded by params()
    return acc;
  }
  if (ct.value === "message/rfc822" && depth < 8) return extract(transferDecode(part), depth + 1, acc);
  const text = decodeBytes(transferDecode(part), ct.params.charset);
  if (ct.value === "text/html") acc.html.push(text);
  else if (ct.value === "text/plain" || ct.value === "") acc.plain.push(text);
  return acc;
}

export function htmlToText(h: string): string {
  return h
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) % 0x110000))
    .replace(/&amp;/g, "&");
}

/** Links become a placeholder so a model reading the mail is not invited to follow them. */
export function stripLinks(s: string, placeholder = "[link]") {
  return s.replace(/\b(?:https?:\/\/|www\.)\S+/gi, placeholder);
}

export function messageText(raw: Uint8Array): { text: string; attachments: string[] } {
  const x = extract(raw);
  const text = x.plain.length ? x.plain.join("\n") : htmlToText(x.html.join("\n"));
  return {
    text: stripLinks(text).replace(/[ \t ]+/g, " ").replace(/\n\s*\n+/g, "\n\n").trim(),
    attachments: x.attachments,
  };
}

/** IMAP mailbox names use modified UTF-7 (RFC 3501). */
export function decodeMUtf7(s: string): string {
  return s.replace(/&([^-]*)-/g, (_, b: string) => {
    if (!b) return "&";
    const bytes = decodeBase64(b.replace(/,/g, "/") + "===".slice((b.length + 3) % 4));
    let out = "";
    for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i]! << 8) | bytes[i + 1]!);
    return out;
  });
}

export function encodeMUtf7(s: string): string {
  let out = "";
  let buf = "";
  const flush = () => {
    if (!buf) return;
    const bytes: number[] = [];
    for (let i = 0; i < buf.length; i++) {
      const c = buf.charCodeAt(i); // UTF-16 code units, as RFC 3501 requires
      bytes.push(c >> 8, c & 0xff);
    }
    out += "&" + btoa(String.fromCharCode(...bytes)).replace(/=+$/, "").replace(/\//g, ",") + "-";
    buf = "";
  };
  for (const ch of s) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) {
      flush();
      out += ch === "&" ? "&-" : ch;
    } else buf += ch;
  }
  flush();
  return out;
}
