import { connect as tlsConnect, type TLSSocket } from "node:tls";
import { connect as netConnect, type Socket } from "node:net";

/**
 * A deliberately tiny, **read-only** IMAP4rev1 client (Node only).
 * It can only LOGIN, LIST, EXAMINE, UID SEARCH, UID FETCH (BODY.PEEK) and LOGOUT.
 * There is no code path that sends STORE, COPY, MOVE, EXPUNGE, APPEND or DELETE.
 */
export interface Untagged {
  line: string; // literals replaced by \x00<index>\x00
  literals: Uint8Array[];
}

export class ImapError extends Error {}

const ALLOWED = /^(CAPABILITY|LOGIN|LIST|EXAMINE|UID SEARCH|UID FETCH|LOGOUT|NOOP)\b/;

export class ImapClient {
  private buf = Buffer.alloc(0);
  private waiters: (() => void)[] = [];
  private closed = false;
  private tag = 0;

  private constructor(private sock: Socket | TLSSocket, private timeoutMs: number) {
    sock.on("data", (d: Buffer) => {
      this.buf = Buffer.concat([this.buf, d]);
      if (this.buf.length > 64 * 1024 * 1024) sock.destroy(new Error("response too large"));
      this.wake();
    });
    sock.on("close", () => ((this.closed = true), this.wake()));
    sock.on("error", () => ((this.closed = true), this.wake()));
    sock.setTimeout(timeoutMs, () => sock.destroy(new Error("timeout")));
  }

  private wake() {
    const w = this.waiters;
    this.waiters = [];
    for (const f of w) f();
  }

  private async need(pred: () => boolean) {
    while (!pred()) {
      if (this.closed) throw new ImapError("connection closed");
      await new Promise<void>((r) => this.waiters.push(r));
    }
  }

  private async readLine(): Promise<string> {
    await this.need(() => this.buf.indexOf("\r\n") >= 0);
    const i = this.buf.indexOf("\r\n");
    const line = this.buf.subarray(0, i).toString("latin1");
    this.buf = this.buf.subarray(i + 2);
    return line;
  }

  private async readBytes(n: number): Promise<Uint8Array> {
    await this.need(() => this.buf.length >= n);
    const out = new Uint8Array(this.buf.subarray(0, n));
    this.buf = this.buf.subarray(n);
    return out;
  }

  /** One logical response line, with any {n} literals pulled in. */
  private async readResponse(): Promise<Untagged> {
    let line = "";
    const literals: Uint8Array[] = [];
    for (;;) {
      const part = await this.readLine();
      const m = part.match(/\{(\d+)\}$/);
      if (!m) return { line: line + part, literals };
      const n = Number(m[1]);
      if (n > 32 * 1024 * 1024) throw new ImapError("literal too large");
      line += part.slice(0, -m[0].length) + `\x00${literals.length}\x00`;
      literals.push(await this.readBytes(n));
    }
  }

  static async open(o: { host: string; port: number; tls: boolean; timeoutMs?: number }): Promise<ImapClient> {
    const timeoutMs = o.timeoutMs ?? 20_000;
    const sock = await new Promise<Socket | TLSSocket>((resolve, reject) => {
      const s = o.tls ? tlsConnect({ host: o.host, port: o.port, servername: o.host }, () => resolve(s)) : netConnect({ host: o.host, port: o.port }, () => resolve(s));
      s.once("error", reject);
      s.setTimeout(timeoutMs, () => s.destroy(new Error("timeout")));
    });
    const c = new ImapClient(sock, timeoutMs);
    const greet = await c.readResponse();
    if (!/^\* (OK|PREAUTH)/i.test(greet.line)) throw new ImapError("unexpected greeting");
    return c;
  }

  static quote(s: string) {
    if (/[\r\n\x00]/.test(s)) throw new ImapError("invalid characters");
    return `"${s.replace(/(["\\])/g, "\\$1")}"`;
  }

  /** Send a command; non-ASCII strings go as literals. Returns untagged responses. */
  async cmd(parts: (string | { literal: string })[]): Promise<Untagged[]> {
    const head = typeof parts[0] === "string" ? parts[0] : "";
    if (!ALLOWED.test(head)) throw new ImapError(`command not allowed: ${head.split(" ")[0]}`);
    const tag = `M${++this.tag}`;
    let chunk = `${tag} `;
    for (const p of parts) {
      if (typeof p === "string") chunk += p;
      else {
        const bytes = Buffer.from(p.literal, "utf8");
        this.sock.write(chunk + `{${bytes.length}}\r\n`);
        const cont = await this.readResponse();
        if (!cont.line.startsWith("+")) throw new ImapError("server refused literal");
        this.sock.write(bytes);
        chunk = "";
      }
    }
    this.sock.write(chunk + "\r\n");
    const out: Untagged[] = [];
    for (;;) {
      const r = await this.readResponse();
      if (r.line.startsWith(tag + " ")) {
        if (!/^\S+ OK/i.test(r.line)) throw new ImapError(r.line.slice(tag.length + 1).replace(/^(NO|BAD)\s*/i, "").slice(0, 200) || "command failed");
        return out;
      }
      if (r.line.startsWith("*")) out.push(r);
    }
  }

  async login(user: string, pass: string) {
    const arg = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? ImapClient.quote(s) : { literal: s });
    await this.cmd(["LOGIN ", arg(user), " ", arg(pass)]);
  }

  async logout() {
    try {
      await this.cmd(["LOGOUT"]);
    } catch {
      /* ignore */
    }
    this.sock.destroy();
  }
}
