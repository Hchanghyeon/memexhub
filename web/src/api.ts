/** Calls to the admin API. The CSRF token from /api/session goes in a header on every change. */
let csrf = "";
export const setCsrf = (v: string) => void (csrf = v);

export class ApiError extends Error {
  constructor(public status: number, public code: string, public detail?: string) {
    super(code);
  }
}

const BASE = "/admin/api";
let onSignedOut: () => void = () => {};
export const whenSignedOut = (fn: () => void) => void (onSignedOut = fn);

async function handle<T>(r: Response): Promise<T> {
  if (r.ok) return (r.headers.get("content-type") ?? "").includes("json") ? r.json() : (r as unknown as T);
  const e = await r.json().catch(() => ({ error: `http_${r.status}` }));
  if (r.status === 401 && e.error === "signed_out") onSignedOut();
  throw new ApiError(r.status, e.error ?? `http_${r.status}`, e.detail);
}

/** Address of a picture or PDF in the vault (same session cookie; for <img src> and links). */
export const fileUrl = (path: string) => `${BASE}/vault/file?path=${encodeURIComponent(path)}`;
export const get = <T>(path: string) => fetch(BASE + path, { credentials: "same-origin" }).then((r) => handle<T>(r));
export const post = <T = { ok: true }>(path: string, body: unknown = {}) =>
  fetch(BASE + path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", "x-csrf": csrf }, body: JSON.stringify(body) }).then((r) => handle<T>(r));
export const upload = <T>(path: string, form: FormData) =>
  fetch(BASE + path, { method: "POST", credentials: "same-origin", headers: { "x-csrf": csrf }, body: form }).then((r) => handle<T>(r));
/** POST that returns a file; the browser saves it. */
export async function download(path: string, fallbackName: string) {
  const r = await fetch(BASE + path, { method: path.endsWith("export") ? "GET" : "POST", credentials: "same-origin", headers: { "x-csrf": csrf } });
  if (!r.ok) return handle(r);
  const name = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const url = URL.createObjectURL(await r.blob());
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface Session {
  setupNeeded: boolean;
  /** On the home network: no authenticator code is asked. */
  home?: boolean;
  signedIn: boolean;
  language: "auto" | "en" | "ko";
  platform: string;
  csrf?: string;
  username?: string;
  totp?: boolean;
  mustEnrol?: boolean;
  onboarded?: boolean;
  error?: string;
  /** Modules that are on: optional pages show only for these. */
  modules?: string[];
}

/** Ask the app to read the session again (after turning a feature on or off, so the menu follows). */
export const refreshSession = () => window.dispatchEvent(new Event("mx:session"));
