/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import type { Hub } from "../hub.js";
import { pageFrame } from "./ui.js";
import type { LedgerAdmin } from "../modules/ledger/admin-api.js";
import type { ReadResult } from "../modules/ledger/messages/types.js";
import { CHANNELS } from "../modules/ledger/messages/types.js";

type Csrf = (p: { c: Context<any> }) => any;
type Flash = { ok?: string; err?: string };

/** Ledger → Recipes & inbox. One screen: try a message, handle the inbox, approve recipes. */
export function recipeRoutes(app: Hono<any>, hub: Hub, Csrf: Csrf, B = "") {
  const frame = pageFrame(hub, B);
  const api = () => hub.moduleAdmin.get("ledger") as LedgerAdmin | undefined;
  const back = (c: Context, f: Flash) => c.redirect(`${B}/ledger/recipes?${new URLSearchParams(f as Record<string, string>)}`);
  const form = async (c: Context) => (await c.req.parseBody()) as Record<string, string>;
  const local = async (iso: string) => {
    const tz = (await hub.settings.get()).timezone;
    return new Intl.DateTimeFormat("sv-SE", { timeZone: tz, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
  };
  const channel = (v: string) => ((CHANNELS as readonly string[]).includes(v) ? v : "sms") as (typeof CHANNELS)[number];

  const page = async (c: Context, extra: { flash?: Flash; tried?: { text: string; channel: string; r: ReadResult }; editor?: string; sample?: string } = {}) => {
    const a = api();
    const flash = extra.flash; // results of "try" and "draft" are shown on the page itself, not after a redirect
    if (!a)
      return frame(c, { title: ["Recipes & inbox", "레시피·대기함"], active: "/ledger/recipes", children: (t) => <div class="card"><p>{t("Turn on the payments feature first.", "먼저 결제 기능을 켜세요.")} <a href={`${B}/features`}>{t("Features", "기능")} →</a></p></div> });
    const [rec, rawInbox] = await Promise.all([a.recipes(), a.inbox()]);
    const inbox = await Promise.all(rawInbox.map(async (i) => ({ ...i, when: await local(i.receivedAt) })));
    const tr0 = extra.tried;
    return frame(c, {
      title: ["Recipes & inbox", "레시피·대기함"],
      active: "/ledger/recipes",
      flash,
      children: (t) => (
        <>
          <h1>{t("Recipes & inbox", "레시피·대기함")}</h1>
          <p class="muted">{t("Messages are read by recipes first, then by the generic parser. What neither can read waits in the inbox. Recipes are notes in", "메시지는 레시피가 먼저, 그다음 공통 해석기가 읽어요. 둘 다 못 읽은 것은 대기함에서 기다려요. 레시피는 이 폴더의 노트예요:")} <code>{a.recipesDir}/</code></p>

          <div class="card" id="inbox">
            <h2>{t(`Inbox (${inbox.length})`, `대기함 (${inbox.length})`)}</h2>
            {!inbox.length && <p class="muted">{t("Nothing waiting.", "기다리는 메시지가 없어요.")}</p>}
            {inbox.map((i) => (
              <form method="post" action={`${B}/ledger/inbox/${i.id}`} style="border-top:1px solid var(--line);padding-top:.7rem;margin-top:.7rem">
                <Csrf c={c} />
                <p class="muted">{i.when} · {i.channel} · {i.reason}</p>
                <pre>{i.data?.message.text ?? ""}</pre>
                <details>
                  <summary>{t("Check or correct the values", "값 확인·고치기")}</summary>
                  <label>{t("Merchant", "가맹점")}<input name="merchant" value={i.data?.guess?.merchant ?? ""} /></label>
                  <label>{t("Amount", "금액")}<input name="amount" value={i.data?.guess?.amount ?? ""} placeholder="₩12,500" /></label>
                  <label>{t("Card", "카드")}<input name="card" value={i.data?.guess?.card ?? ""} /></label>
                  <label>{t("Time", "시각")}<input name="time" value={i.data?.guess?.time ?? ""} placeholder="2026-10-14T12:30:00+09:00" /></label>
                </details>
                <div class="row">
                  <button name="action" value="record" class="small">{t("Record", "기록")}</button>
                  <button name="action" value="ignore" class="secondary small">{t("Ignore", "버리기")}</button>
                  <button class="secondary small" formaction={`${B}/ledger/draft-from`} name="id" value={i.id}>{t("Make a recipe from it", "이걸로 레시피 만들기")}</button>
                </div>
              </form>
            ))}
          </div>

          <div class="card" id="try">
            <h2>{t("Try a message", "메시지 시험")}</h2>
            <form method="post" action={`${B}/ledger/try`}>
              <Csrf c={c} />
              <label>{t("Message", "메시지")}<textarea name="text" rows={5} required>{tr0?.text ?? extra.sample ?? ""}</textarea></label>
              <label>{t("Kind", "종류")}<select name="channel">{CHANNELS.map((ch) => <option value={ch} selected={(tr0?.channel ?? "sms") === ch}>{ch}</option>)}</select></label>
              <button>{t("Try", "시험")}</button>
              <button class="secondary" formaction={`${B}/ledger/draft`}>{t("Make a recipe from it", "이걸로 레시피 만들기")}</button>
            </form>
            {tr0 && (
              <div>
                <p>
                  {tr0.r.kind === "ignore" ? `Ignored by recipe ${tr0.r.recipeId}.` : tr0.r.confident
                    ? `Would be recorded — ${tr0.r.step === "recipe" ? `recipe ${tr0.r.recipeId}` : "generic parser"}.`
                    : `Would go to the inbox — ${tr0.r.reason ?? "unreadable"}.`}
                </p>
                {tr0.r.payment && (
                  <div class="tw"><table>{Object.entries(tr0.r.payment).filter(([, v]) => v).map(([k, v]) => <tr><th>{k}</th><td>{v}</td></tr>)}</table></div>
                )}
              </div>
            )}
          </div>

          <div class="card" id="recipes">
            <h2>{t("Recipes", "레시피")}</h2>
            <h3>{t(`Waiting for approval (${rec.proposed.files.length})`, `승인 대기 (${rec.proposed.files.length})`)}</h3>
            {!rec.proposed.files.length && <p class="muted">{t("No proposals. Claude adds them with ledger_recipe_propose.", "제안이 없어요. Claude가 ledger_recipe_propose로 추가해요.")}</p>}
            <ul class="list">
              {rec.proposed.files.map((f) => {
                const id = f.split("/").pop()!.replace(/\.md$/, "");
                const err = rec.proposed.errors.find((e) => e.path === f);
                return (
                  <li style="flex-wrap:wrap">
                    <span style="flex:1;min-width:12rem"><b>{id}</b><span class="hint">{err ? <span class="err">✗ {err.error}</span> : <span class="ok">✓ {t("examples pass", "예시 통과")}</span>}</span></span>
                    {!err && <form method="post" action={`${B}/ledger/recipes/approve`} class="inline"><Csrf c={c} /><button class="small" name="file" value={f}>{t("Approve", "승인")}</button></form>}
                  </li>
                );
              })}
            </ul>
            <h3>{t(`Active (${rec.active.length})`, `사용 중 (${rec.active.length})`)}</h3>
            <ul class="list">
              {rec.active.map((r) => (
                <li style="flex-wrap:wrap">
                  <span style="flex:1;min-width:12rem"><b>{r.recipe.name ?? r.recipe.id}</b><span class="hint">{r.recipe.id} · {r.recipe.kind} · {r.recipe.channels.join(", ")} · {r.path ?? t("built-in", "기본")}</span></span>
                  <form method="post" action={`${B}/ledger/recipes/disable`} class="inline"><Csrf c={c} /><button class="secondary small" name="id" value={r.recipe.id}>{t("Disable", "끄기")}</button></form>
                </li>
              ))}
            </ul>
            {rec.errors.length > 0 && (
              <div>
                <h3>{t(`Not used (${rec.errors.length})`, `쓰지 않음 (${rec.errors.length})`)}</h3>
                <ul class="list">{rec.errors.map((e) => <li><span><b>{e.path ?? e.id}</b>: <span class="err">{e.error}</span></span></li>)}</ul>
              </div>
            )}
          </div>

          <div class="card" id="editor">
            <h2>{t("New recipe", "새 레시피")}</h2>
            <p class="muted">{t("Saved as a proposal; approve it above to use it. Format: docs/recipes.md. If you share it, rewrite the example with fake names and numbers.", "제안으로 저장돼요. 위에서 승인해야 써요. 형식은 docs/recipes.md. 공유할 때는 예시의 이름과 숫자를 가짜로 바꾸세요.")}</p>
            <form method="post" action={`${B}/ledger/recipes/save`}>
              <Csrf c={c} />
              <label>{t("Recipe (JSON)", "레시피 (JSON)")}<textarea name="json" rows={14} required>{extra.editor ?? ""}</textarea></label>
              <button>{t("Save as proposal", "제안으로 저장")}</button>
            </form>
          </div>

          <div class="card" id="share">
            <h2>{t("Import / export", "가져오기·내보내기")}</h2>
            <p><a href={`${B}/ledger/recipes/export`}>{t("Download active recipes (JSON)", "사용 중인 레시피 내려받기 (JSON)")}</a></p>
            <form method="post" action={`${B}/ledger/recipes/import`}>
              <Csrf c={c} />
              <label>{t("Paste a recipe pack (JSON array)", "레시피 묶음 붙여 넣기 (JSON 배열)")}<textarea name="json" rows={4} required></textarea></label>
              <button class="secondary">{t("Import as proposals", "제안으로 가져오기")}</button>
            </form>
          </div>
        </>
      ),
    });
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
