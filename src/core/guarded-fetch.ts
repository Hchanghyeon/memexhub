/**
 * Outbound HTTP for providers. Defends against SSRF:
 * - only hosts derived from the connection's own config
 * - https only, unless the connection explicitly allows the private network
 * - private / loopback / link-local targets refused unless allowed (checked by the platform's resolver)
 * - redirects are never followed; timeout; response size cap
 */
export interface GuardOptions {
  hosts: string[]; // lowercase host names (no port)
  allowPrivate: boolean;
  timeoutMs?: number;
  maxBytes?: number;
  isPrivate?: (host: string) => Promise<boolean>; // platform resolver
}

export class BlockedRequest extends Error {}

export function guardedFetch(base: typeof fetch, o: GuardOptions): typeof fetch {
  const hosts = new Set(o.hosts.map((h) => h.toLowerCase()));
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (!hosts.has(url.hostname.toLowerCase())) throw new BlockedRequest(`host not allowed: ${url.hostname}`);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && o.allowPrivate)) throw new BlockedRequest("https required");
    if (url.username || url.password) throw new BlockedRequest("credentials in URL are not allowed");
    if (!o.allowPrivate && o.isPrivate && (await o.isPrivate(url.hostname))) throw new BlockedRequest("private network address not allowed");
    const res = await base(url, { ...init, redirect: "manual", signal: init?.signal ?? AbortSignal.timeout(o.timeoutMs ?? 15_000) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) throw new BlockedRequest("redirects are not followed");
    const max = o.maxBytes ?? 5 * 1024 * 1024;
    const len = Number(res.headers.get("content-length") ?? 0);
    if (len > max) throw new BlockedRequest("response too large");
    if (!res.body) return res;
    // Enforce the cap while streaming, then hand back a fresh Response.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel();
        throw new BlockedRequest("response too large");
      }
      chunks.push(value);
    }
    const body = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) (body.set(c, off), (off += c.byteLength));
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  }) as typeof fetch;
}
