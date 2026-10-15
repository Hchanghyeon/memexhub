/** CIDR matching for IPv4 and IPv6 without dependencies. */
function v4(ip: string): bigint | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts.reduce((a, p) => (a << 8n) | BigInt(p), 0n);
}

function v6(ip: string): bigint | null {
  if (!ip.includes(":")) return null;
  let [head, tail] = ip.split("::") as [string, string | undefined];
  const h = head ? head.split(":") : [];
  const t = tail !== undefined ? (tail ? tail.split(":") : []) : [];
  const last = (t.length ? t : h).at(-1);
  const extra: string[] = [];
  if (last && last.includes(".")) {
    const n = v4(last);
    if (n === null) return null;
    (t.length ? t : h).pop();
    extra.push(((n >> 16n) & 0xffffn).toString(16), (n & 0xffffn).toString(16));
  }
  const groups = tail !== undefined ? [...h, ...Array(8 - h.length - t.length - extra.length).fill("0"), ...t, ...extra] : [...h, ...extra];
  if (groups.length !== 8) return null;
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/i.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const [net, bitsStr] = cidr.split("/");
  const clean = ip.replace(/^::ffff:(?=\d+\.)/i, "");
  const a4 = v4(clean), n4 = v4(net ?? "");
  if (a4 !== null && n4 !== null) {
    const bits = BigInt(bitsStr ?? 32);
    const mask = bits === 0n ? 0n : ((1n << 32n) - 1n) ^ ((1n << (32n - bits)) - 1n);
    return (a4 & mask) === (n4 & mask);
  }
  const a6 = v6(clean), n6 = v6(net ?? "");
  if (a6 !== null && n6 !== null) {
    const bits = BigInt(bitsStr ?? 128);
    const full = (1n << 128n) - 1n;
    const mask = bits === 0n ? 0n : full ^ ((1n << (128n - bits)) - 1n);
    return (a6 & mask) === (n6 & mask);
  }
  return false;
}

export const inAny = (ip: string, cidrs: string[]) => cidrs.some((c) => ipInCidr(ip, c));

/**
 * Real client IP. Proxy headers are only trusted when the TCP peer is a trusted proxy,
 * so a client cannot spoof X-Real-IP from the internet.
 */
export function clientIp(peer: string, headers: Headers, trusted: string[]): string {
  if (peer && inAny(peer, trusted)) {
    const real = headers.get("x-real-ip")?.trim();
    if (real) return real;
    const xff = headers.get("x-forwarded-for");
    if (xff) return xff.split(",").at(-1)!.trim();
  }
  return peer;
}

export const PRIVATE_CIDRS = ["127.0.0.0/8", "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "::1/128", "fc00::/7", "fe80::/10"];
