/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import type { Hub } from "../hub.js";
import { Layout } from "./layout.js";
import { PRESETS } from "../modules/wiki/layout.js";

type Csrf = (p: { c: Context<any> }) => any;
const STEPS = ["Time zone & language", "Vault", "Wiki layout", "Connect Claude"] as const;
const PRESET_TEXT: Record<string, string> = {
  "llm-wiki": "Sources in raw/, pages Claude writes in wiki/ (recommended for a new vault)",
  para: "Projects, Areas, Resources, Archives (English folders)",
  "para-ko": "PARA with Korean folder names",
  zettelkasten: "One folder of linked notes, sources apart",
  flat: "Everything in one folder",
};

/** /start — the first-run wizard. One question per screen, recommended option first, every step skippable. */
export function wizardRoutes(app: Hono<any>, hub: Hub, Csrf: Csrf, B: string) {
  const R = B || "/";
  const step = (n: number) => `${B}/start?step=${n}`;
  const Frame = (p: { n: number; children: any }) => (
    <Layout title={`Set up · ${STEPS[p.n - 1]}`}>
      <p class="muted">Step {p.n} of {STEPS.length} · {STEPS.map((s, i) => (i + 1 === p.n ? <b>{s}</b> : s)).reduce((a: any[], x, i) => (i ? [...a, " → ", x] : [x]), [])}</p>
      <h1>{STEPS[p.n - 1]}</h1>
      {p.children}
      <p>{p.n < STEPS.length ? <a href={step(p.n + 1)}>Skip this step</a> : null} · <a href={R}>Go to the dashboard</a></p>
    </Layout>
  );

  app.get("/start", async (c) => {
    const s = await hub.settings.get();
    const n = Math.min(STEPS.length, Math.max(1, Number(c.req.query("step")) || 1));
    if (n === 1) {
      const zones = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
      return c.html(
        <Frame n={1}>
          <form method="post" action={`${B}/start/basics`}>
            <Csrf c={c} />
            <label>Time zone — dates in notes and summaries use it
              <select name="timezone">{(zones ?? ["UTC"]).map((z) => <option value={z} selected={z === s.timezone}>{z}</option>)}</select>
            </label>
            <label>Language of notes the engine writes
              <select name="notes"><option value="en" selected={s.ledger.language === "en"}>English</option><option value="ko" selected={s.ledger.language === "ko"}>한국어</option></select>
            </label>
            <label>Language of tool descriptions Claude sees
              <select name="tools">{(["en", "ko", "both"] as const).map((l) => <option value={l} selected={s.toolLanguage === l}>{{ en: "English", ko: "한국어", both: "Both" }[l]}</option>)}</select>
            </label>
            <button>Next</button>
          </form>
        </Frame>,
      );
    }
    if (n === 2)
      return c.html(
        <Frame n={2}>
          <p>{hub.vault ? <span class="ok">A vault is connected. You can keep it and skip this step.</span> : "Where should your notes live?"}</p>
          <form method="post" action={`${B}/vault`}>
            <Csrf c={c} />
            <input type="hidden" name="next" value="3" />
            <label><input type="radio" name="provider" value="builtin" checked style="display:inline;width:auto;margin-right:.4rem" /><b>Create on this server</b> (recommended) — you can sync it to Obsidian on your devices later</label>
            <label><input type="radio" name="provider" value="folder" style="display:inline;width:auto;margin-right:.4rem" />An existing folder on this server</label>
            <label>Folder path (only for an existing folder)<input name="path" /></label>
            <label><input type="radio" name="provider" value="webdav" style="display:inline;width:auto;margin-right:.4rem" />A WebDAV server (Nextcloud, NAS)</label>
            <label>WebDAV URL<input name="url" placeholder="https://dav.example.com/vault" /></label>
            <label>WebDAV username<input name="username" autocomplete="off" /></label>
            <label>WebDAV password (stored encrypted)<input name="password" type="password" autocomplete="new-password" /></label>
            <button>Connect and continue</button>
          </form>
        </Frame>,
      );
    if (n === 3)
      return c.html(
        <Frame n={3}>
          <p>memexhub knows roles (sources, wiki pages, rules), not folder names. Pick the layout closest to yours; you can adjust every folder later.</p>
          <form method="post" action={`${B}/wiki/preset`}>
            <Csrf c={c} />
            <input type="hidden" name="next" value="4" />
            {Object.keys(PRESETS).map((p, i) => (
              <label><input type="radio" name="preset" value={p} checked={(s.wiki.preset ?? "llm-wiki") === p || (!s.wiki.preset && i === 0)} style="display:inline;width:auto;margin-right:.4rem" /><b>{p}</b> — {PRESET_TEXT[p] ?? ""}</label>
            ))}
            <button>Use this layout</button>
          </form>
        </Frame>,
      );
    return c.html(
      <Frame n={4}>
        <p>In the Claude app: <b>Settings → Connectors → Add custom connector</b>, paste this address, then sign in with your admin account when asked:</p>
        <pre>{hub.env.PUBLIC_URL}/mcp</pre>
        <p class="muted">Claude can then read and write your vault. Phones and apps that send records use device tokens — create them on the dashboard under Devices.</p>
        <form method="post" action={`${B}/start/done`}><Csrf c={c} /><button>Finish</button></form>
      </Frame>,
    );
  });

  app.post("/start/basics", async (c) => {
    const f = (await c.req.parseBody()) as Record<string, string>;
    const s = await hub.settings.get();
    const zones = ((Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined) ?? ["UTC"];
    const tz = zones.includes(f.timezone ?? "") ? f.timezone! : s.timezone;
    const notes = f.notes === "ko" ? "ko" : "en";
    await hub.settings.set("timezone", tz);
    await hub.settings.set("toolLanguage", f.tools === "ko" || f.tools === "both" ? f.tools : "en");
    await hub.settings.set("ledger", { ...s.ledger, language: notes });
    await hub.settings.set("health", { ...s.health, language: notes });
    await hub.settings.set("location", { ...s.location, language: notes });
    await hub.reload();
    return c.redirect(step(2));
  });
  app.post("/start/done", async (c) => {
    await hub.settings.set("onboarded", true);
    return c.redirect(R);
  });
}

/** Only "go to wizard step N" is accepted as a redirect target from forms (no open redirects). */
export const wizardNext = (B: string, v: unknown) => (/^[1-4]$/.test(String(v ?? "")) ? `${B}/start?step=${v}` : undefined);
