/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import type { Hub } from "../hub.js";
import { Layout } from "./layout.js";
import type { LedgerAdmin } from "../modules/ledger/admin-api.js";
import type { ReadResult } from "../modules/ledger/messages/types.js";
import { CHANNELS } from "../modules/ledger/messages/types.js";

type Csrf = (p: { c: Context<any> }) => any;
type Flash = { ok?: string; err?: string };

/** Ledger → Recipes & inbox. One screen: try a message, handle the inbox, approve recipes. */
export function recipeRoutes(app: Hono<any>, hub: Hub, Csrf: Csrf) {
  const api = () => hub.moduleAdmin.get("ledger") as LedgerAdmin | undefined;
  const back = (c: Context, f: Flash) => c.redirect(`/ledger/recipes?${new URLSearchParams(f as Record<string, string>)}`);
  const form = async (c: Context) => (await c.req.parseBody()) as Record<string, string>;
  const local = async (iso: string) => {
    const tz = (await hub.settings.get()).timezone;
    return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  };
  const channel = (v: string) => ((CHANNELS as readonly string[]).includes(v) ? v : "sms") as (typeof CHANNELS)[number];

  const page = async (c: Context, extra: { flash?: Flash; tried?: { text: string; channel: string; r: ReadResult }; editor?: string; sample?: string } = {}) => {
    const a = api();
    if (!a) return c.html(<Layout title="Recipes"><p><a href="/">← Back</a></p><p>Turn on the ledger feature first.</p></Layout>);
    const flash = extra.flash ?? { ok: c.req.query("ok"), err: c.req.query("err") };
    const [rec, rawInbox] = await Promise.all([a.recipes(), a.inbox()]);
    const inbox = await Promise.all(rawInbox.map(async (i) => ({ ...i, when: await local(i.receivedAt) })));
    const t = extra.tried;
    return c.html(
      <Layout title="Recipes & inbox — memexhub">
        <p><a href="/#features">← Back</a></p>
        <h1>Recipes & inbox</h1>
        <p class="muted">Messages are read by recipes first, then by the generic parser. What neither can read waits in the inbox. Recipes are notes in <code>{a.recipesDir}/</code>.</p>
        {flash.ok && <p class="ok">{flash.ok}</p>}
        {flash.err && <p class="err">{flash.err}</p>}

        <div class="card" id="try">
          <h2>Try a message</h2>
          <form method="post" action="/ledger/try">
            <Csrf c={c} />
            <label>Message<textarea name="text" rows={5} required>{t?.text ?? extra.sample ?? ""}</textarea></label>
            <label>Kind<select name="channel">{CHANNELS.map((ch) => <option value={ch} selected={(t?.channel ?? "sms") === ch}>{ch}</option>)}</select></label>
            <button>Try</button>
            <button class="secondary" formaction="/ledger/draft">Make a recipe from it</button>
          </form>
          {t && (
            <div>
              <p>
                {t.r.kind === "ignore" ? `Ignored by recipe ${t.r.recipeId}.` : t.r.confident
                  ? `Would be recorded — ${t.r.step === "recipe" ? `recipe ${t.r.recipeId}` : "generic parser"}.`
                  : `Would go to the inbox — ${t.r.reason ?? "unreadable"}.`}
              </p>
              {t.r.payment && (
                <table>{Object.entries(t.r.payment).filter(([, v]) => v).map(([k, v]) => <tr><th>{k}</th><td>{v}</td></tr>)}</table>
              )}
            </div>
          )}
        </div>

        <div class="card" id="inbox">
          <h2>Inbox ({inbox.length})</h2>
          {!inbox.length && <p class="muted">Nothing waiting.</p>}
          {inbox.map((i) => (
            <form method="post" action={`/ledger/inbox/${i.id}`} style="border-top:1px solid #ddd;padding-top:.6rem">
              <Csrf c={c} />
              <p class="muted">{i.when} · {i.channel} · {i.reason}</p>
              <pre style="white-space:pre-wrap">{i.data?.message.text ?? ""}</pre>
              <label>Merchant<input name="merchant" value={i.data?.guess?.merchant ?? ""} /></label>
              <label>Amount<input name="amount" value={i.data?.guess?.amount ?? ""} placeholder="₩12,500" /></label>
              <label>Card<input name="card" value={i.data?.guess?.card ?? ""} /></label>
              <label>Time<input name="time" value={i.data?.guess?.time ?? ""} placeholder="2026-10-14T12:30:00+09:00" /></label>
              <button name="action" value="record">Record</button>
              <button name="action" value="ignore" class="secondary">Ignore</button>
              <button class="secondary" formaction="/ledger/draft-from" name="id" value={i.id}>Make a recipe from it</button>
            </form>
          ))}
        </div>

        <div class="card" id="recipes">
          <h2>Recipes</h2>
          <h3>Waiting for approval ({rec.proposed.files.length})</h3>
          {!rec.proposed.files.length && <p class="muted">No proposals. Claude adds them with <code>ledger_recipe_propose</code>.</p>}
          <table>
            {rec.proposed.files.map((f) => {
              const id = f.split("/").pop()!.replace(/\.md$/, "");
              const err = rec.proposed.errors.find((e) => e.path === f);
              return (
                <tr>
                  <td>{id}</td>
                  <td>{err ? <span class="err">✗ {err.error}</span> : <span class="ok">✓ examples pass</span>}</td>
                  <td>{!err && <form method="post" action="/ledger/recipes/approve"><Csrf c={c} /><button name="file" value={f}>Approve</button></form>}</td>
                </tr>
              );
            })}
          </table>
          <h3>Active ({rec.active.length})</h3>
          <table>
            <tr><th>Recipe</th><th>From</th><th></th></tr>
            {rec.active.map((r) => (
              <tr>
                <td>{r.recipe.name ?? r.recipe.id}<br /><span class="muted">{r.recipe.id} · {r.recipe.kind} · {r.recipe.channels.join(", ")}</span></td>
                <td>{r.path ?? "built-in"}</td>
                <td><form method="post" action="/ledger/recipes/disable"><Csrf c={c} /><button class="secondary" name="id" value={r.recipe.id}>Disable</button></form></td>
              </tr>
            ))}
          </table>
          {rec.errors.length > 0 && (
            <div>
              <h3>Not used ({rec.errors.length})</h3>
              <ul>{rec.errors.map((e) => <li><b>{e.path ?? e.id}</b>: <span class="err">{e.error}</span></li>)}</ul>
            </div>
          )}
        </div>

        <div class="card" id="editor">
          <h2>New recipe</h2>
          <p class="muted">Saved as a proposal; approve it above to use it. Format: docs/recipes.md. If you share it, rewrite the example with fake names and numbers.</p>
          <form method="post" action="/ledger/recipes/save">
            <Csrf c={c} />
            <label>Recipe (JSON)<textarea name="json" rows={14} required>{extra.editor ?? ""}</textarea></label>
            <button>Save as proposal</button>
          </form>
        </div>

        <div class="card" id="share">
          <h2>Import / export</h2>
          <p><a href="/ledger/recipes/export">Download active recipes (JSON)</a></p>
          <form method="post" action="/ledger/recipes/import">
            <Csrf c={c} />
            <label>Paste a recipe pack (JSON array)<textarea name="json" rows={4} required></textarea></label>
            <button class="secondary">Import as proposals</button>
          </form>
        </div>
      </Layout>,
    );
  };

  const act = (fn: (a: LedgerAdmin, f: Record<string, string>, c: Context) => Promise<string>) => async (c: Context) => {
    const a = api();
    if (!a) return back(c, { err: "Turn on the ledger feature first." });
    try {
      return back(c, { ok: await fn(a, await form(c), c) });
    } catch (e) {
      return back(c, { err: (e as Error).message.slice(0, 300) });
    }
  };

  app.get("/ledger/recipes", (c) => page(c));
  app.post("/ledger/try", async (c) => {
    const f = await form(c);
    const text = String(f.text ?? "").slice(0, 16_000);
    if (!text.trim()) return page(c, { flash: { err: "Paste a message first." } });
    const ch = channel(f.channel ?? "");
    return page(c, { tried: { text, channel: ch, r: await api()!.read({ channel: ch, text }) } });
  });
  app.post("/ledger/draft", async (c) => {
    const f = await form(c);
    const text = String(f.text ?? "").slice(0, 4000);
    if (!text.trim()) return page(c, { flash: { err: "Paste a message first." } });
    return page(c, { editor: await api()!.draft({ channel: channel(f.channel ?? ""), text }), sample: text, flash: { ok: "Draft below — check the match words and the expected values, then save." } });
  });
  app.post("/ledger/draft-from", async (c) => {
    const f = await form(c);
    const it = (await api()!.inbox()).find((i) => i.id === f.id);
    if (!it?.data) return back(c, { err: "This item is no longer pending." });
    const m = it.data.message;
    return page(c, { editor: await api()!.draft({ channel: m.channel ?? "sms", text: m.text }), sample: m.text, flash: { ok: "Draft below — check the match words and the expected values, then save." } });
  });
  app.post("/ledger/recipes/save", act((a, f) => a.saveProposal(String(f.json ?? ""))));
  app.post("/ledger/recipes/approve", act((a, f) => a.approve(String(f.file ?? ""))));
  app.post("/ledger/recipes/disable", act((a, f) => a.disable(String(f.id ?? ""))));
  app.post("/ledger/recipes/import", act((a, f) => a.importPack(String(f.json ?? "").slice(0, 200_000))));
  app.get("/ledger/recipes/export", async (c) => {
    const a = api();
    if (!a) return c.text("ledger is off", 404);
    c.header("content-disposition", 'attachment; filename="memexhub-recipes.json"');
    return c.body(await a.exportPack(), 200, { "content-type": "application/json; charset=utf-8" });
  });
  app.post("/ledger/inbox/:id", act((a, f, c) =>
    a.resolve(c.req.param("id") ?? "", f.action === "ignore" ? "ignore" : "record", { merchant: f.merchant, amount: f.amount, card: f.card, time: f.time }),
  ));
}
