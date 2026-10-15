import { z } from "zod";
import { defineProvider } from "../src/providers/types.js";
import { T } from "../src/core/i18n.js";
import { FsStorage } from "../src/storage/fs.js";

/** A storage provider pinned to a temp folder, for tests. */
export const testFs = (root: string) =>
  defineProvider({ kind: "storage", id: "fs", title: T("test", "test"), config: z.object({ path: z.string().optional() }), runtimes: ["node"], create: () => new FsStorage(root) });

/**
 * A tiny in-memory S3 (path style) for contract tests: GET/PUT/HEAD/DELETE objects, conditional PUT,
 * CopyObject and ListObjectsV2 with paging. Checks that requests are SigV4-signed.
 */
export function fakeS3(bucket = "vault-bucket", pageSize = 2) {
  const objects = new Map<string, { body: string; etag: string; mtime: Date }>();
  let n = 0;
  const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = new URL(String(input));
    const h = new Headers(init?.headers);
    if (!/^AWS4-HMAC-SHA256 Credential=/.test(h.get("authorization") ?? "")) return new Response("unsigned", { status: 403 });
    const [, b, ...rest] = u.pathname.split("/");
    if (b !== bucket) return new Response("no bucket", { status: 404 });
    const key = rest.map(decodeURIComponent).join("/");
    const method = init?.method ?? "GET";
    const obj = objects.get(key);
    if (!key && method === "GET") {
      const prefix = u.searchParams.get("prefix") ?? "";
      const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = Number(u.searchParams.get("continuation-token") ?? 0);
      const page = all.slice(start, start + pageSize);
      const more = start + pageSize < all.length;
      const body = `<ListBucketResult>${page.map((k) => `<Contents><Key>${xml(k)}</Key><LastModified>${objects.get(k)!.mtime.toISOString()}</LastModified><ETag>${xml(objects.get(k)!.etag)}</ETag><Size>${objects.get(k)!.body.length}</Size></Contents>`).join("")}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : ""}</ListBucketResult>`;
      return new Response(body, { headers: { "content-type": "application/xml" } });
    }
    if (method === "GET" || method === "HEAD") {
      if (!obj) return new Response(null, { status: 404 });
      return new Response(method === "HEAD" ? null : obj.body, { headers: { etag: obj.etag, "content-length": String(obj.body.length), "last-modified": obj.mtime.toUTCString() } });
    }
    if (method === "PUT") {
      if (h.get("if-none-match") === "*" && obj) return new Response("exists", { status: 412 });
      if (h.get("if-match") && h.get("if-match") !== obj?.etag) return new Response("changed", { status: 412 });
      const src = h.get("x-amz-copy-source");
      let body = String(init?.body ?? "");
      if (src) {
        const sk = src.split("/").slice(2).map(decodeURIComponent).join("/");
        const so = objects.get(sk);
        if (!so) return new Response(null, { status: 404 });
        body = so.body;
      }
      const etag = `"e${++n}"`;
      objects.set(key, { body, etag, mtime: new Date() });
      return new Response(null, { headers: { etag } });
    }
    if (method === "DELETE") {
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 405 });
  }) as typeof fetch;
  return { fetch: f, objects };
}
