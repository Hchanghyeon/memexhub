/** @jsxImportSource hono/jsx */
import type { Context, Hono } from "hono";
import type { Hub } from "../hub.js";
import { Layout } from "./layout.js";
import { langOf, tr, type Tr } from "./ui.js";
import { PRESETS } from "../modules/wiki/layout.js";

type Csrf = (p: { c: Context<any> }) => any;
const STEPS: [string, string][] = [["Time zone & language", "시간대·언어"], ["Vault", "볼트"], ["Wiki layout", "위키 구조"], ["Connect Claude", "Claude 연결"]];
const PRESET_TEXT: Record<string, [string, string]> = {
  "llm-wiki": ["Sources in raw/, pages Claude writes in wiki/ (recommended for a new vault)", "원본은 raw/, Claude가 쓰는 페이지는 wiki/ (새 볼트에 추천)"],
  para: ["Projects, Areas, Resources, Archives (English folders)", "Projects, Areas, Resources, Archives (영어 폴더)"],
  "para-ko": ["PARA with Korean folder names", "한국어 폴더 이름의 PARA"],
  zettelkasten: ["One folder of linked notes, sources apart", "연결된 노트 한 폴더, 원본은 따로"],
  flat: ["Everything in one folder", "모두 한 폴더에"],
};

/** /start — the first-run wizard. One question per screen, recommended option first, every step skippable. */
export function wizardRoutes(app: Hono<any>, hub: Hub, Csrf: Csrf, B: string) {
  const R = B || "/";
  const step = (n: number) => `${B}/start?step=${n}`;
  const Frame = (p: { n: number; t: Tr; lang: "en" | "ko"; children: any }) => (
    <Layout title={`${p.t("Set up", "설정")} · ${p.t(...STEPS[p.n - 1]!)}`} lang={p.lang}>
      <p class="muted">{p.t(`Step ${p.n} of ${STEPS.length}`, `${STEPS.length}단계 중 ${p.n}단계`)} · {STEPS.map((s, i) => (i + 1 === p.n ? <b>{p.t(...s)}</b> : p.t(...s))).reduce((a: any[], x, i) => (i ? [...a, " → ", x] : [x]), [])}</p>
      <div class="card">
        <h1>{p.t(...STEPS[p.n - 1]!)}</h1>
        {p.children}
      </div>
      <p class="muted">{p.n < STEPS.length ? <><a href={step(p.n + 1)}>{p.t("Skip this step", "이 단계 건너뛰기")}</a> · </> : null}<a href={R}>{p.t("Go to the overview", "개요로 가기")}</a></p>
    </Layout>
  );
  const radio = "display:inline;width:auto;margin-right:.5rem";

  app.get("/start", async (c) => {
    const s = await hub.settings.get();
    const lang = await langOf(hub, c);
    const t = tr(lang);
    const n = Math.min(STEPS.length, Math.max(1, Number(c.req.query("step")) || 1));
    if (n === 1) {
      const zones = (Intl as any).supportedValuesOf?.("timeZone") as string[] | undefined;
      return c.html(
        <Frame n={1} t={t} lang={lang}>
          <form method="post" action={`${B}/start/basics`}>
            <Csrf c={c} />
            <label>{t("Time zone", "시간대")}<span class="hint">{t("Dates in notes and summaries use it.", "노트와 요약의 날짜에 써요.")}</span>
              <select name="timezone">{(zones ?? ["UTC"]).map((z) => <option value={z} selected={z === s.timezone}>{z}</option>)}</select>
            </label>
            <label>{t("Language of notes the engine writes", "엔진이 쓰는 노트의 언어")}
              <select name="notes"><option value="en" selected={s.ledger.language === "en"}>English</option><option value="ko" selected={s.ledger.language === "ko"}>한국어</option></select>
            </label>
            <label>{t("Language of tool descriptions Claude sees", "Claude가 보는 도구 설명 언어")}
              <select name="tools">{(["en", "ko", "both"] as const).map((l) => <option value={l} selected={s.toolLanguage === l}>{{ en: "English", ko: "한국어", both: t("Both", "둘 다") }[l]}</option>)}</select>
            </label>
            <button>{t("Next", "다음")}</button>
          </form>
        </Frame>,
      );
    }
    if (n === 2)
      return c.html(
        <Frame n={2} t={t} lang={lang}>
          <p>{hub.vault ? <span class="ok">{t("A vault is connected. You can keep it and skip this step.", "볼트가 연결돼 있어요. 그대로 두고 건너뛰어도 돼요.")}</span> : t("Where should your notes live?", "노트를 어디에 둘까요?")}</p>
          <form method="post" action={`${B}/vault`}>
            <Csrf c={c} />
            <input type="hidden" name="next" value="3" />
            {hub.platform.name === "workers" ? (
              <label><input type="radio" name="provider" value="r2" checked style={radio} /><b>{t("This Worker's R2 bucket", "이 Worker의 R2 버킷")}</b> ({t("recommended", "추천")}) — {t("sync it to Obsidian with Remotely Save (S3)", "Remotely Save(S3)로 Obsidian과 동기화")}</label>
            ) : (
              <>
                <label><input type="radio" name="provider" value="builtin" checked style={radio} /><b>{t("Create on this server", "이 서버에 만들기")}</b> ({t("recommended", "추천")}) — {t("you can sync it to Obsidian on your devices later", "나중에 기기의 Obsidian과 동기화할 수 있어요")}</label>
                <label><input type="radio" name="provider" value="folder" style={radio} />{t("An existing folder on this server", "이 서버의 기존 폴더")}</label>
                <label>{t("Folder path (only for an existing folder)", "폴더 경로 (기존 폴더일 때만)")}<input name="path" /></label>
              </>
            )}
            <label><input type="radio" name="provider" value="webdav" style={radio} />{t("A WebDAV server (Nextcloud, NAS)", "WebDAV 서버 (Nextcloud, NAS)")}</label>
            <label>WebDAV URL<input name="url" placeholder="https://dav.example.com/vault" /></label>
            <label>{t("WebDAV username", "WebDAV 아이디")}<input name="username" autocomplete="off" /></label>
            <label>{t("WebDAV password (stored encrypted)", "WebDAV 비밀번호 (암호화해 저장)")}<input name="password" type="password" autocomplete="new-password" /></label>
            <button>{t("Connect and continue", "연결하고 계속")}</button>
          </form>
        </Frame>,
      );
    if (n === 3)
      return c.html(
        <Frame n={3} t={t} lang={lang}>
          <p>{t("memexhub knows roles (sources, wiki pages, rules), not folder names. Pick the layout closest to yours; you can adjust every folder later.", "memexhub는 폴더 이름이 아니라 역할(원본, 위키 페이지, 규칙)을 알아요. 가장 비슷한 구조를 고르세요. 폴더는 나중에 다 바꿀 수 있어요.")}</p>
          <form method="post" action={`${B}/wiki/preset`}>
            <Csrf c={c} />
            <input type="hidden" name="next" value="4" />
            {Object.keys(PRESETS).map((p, i) => (
              <label><input type="radio" name="preset" value={p} checked={(s.wiki.preset ?? "llm-wiki") === p || (!s.wiki.preset && i === 0)} style={radio} /><b>{p}</b> — {PRESET_TEXT[p] ? t(...PRESET_TEXT[p]!) : ""}</label>
            ))}
            <button>{t("Use this layout", "이 구조 쓰기")}</button>
          </form>
        </Frame>,
      );
    return c.html(
      <Frame n={4} t={t} lang={lang}>
        <p>{t("In the Claude app: Settings → Connectors → Add custom connector, paste this address, then sign in with your admin account when asked:", "Claude 앱: 설정 → 커넥터 → 사용자 지정 커넥터 추가에서 이 주소를 붙여 넣고, 물어보면 관리자 계정으로 로그인하세요:")}</p>
        <pre>{hub.env.PUBLIC_URL}/mcp</pre>
        <p class="muted">{t("Claude can then read and write your vault. Phones and apps that send records use device tokens — create them under Devices.", "그러면 Claude가 볼트를 읽고 쓸 수 있어요. 기록을 보내는 폰과 앱은 기기 토큰을 써요. 기기 화면에서 만드세요.")}</p>
        <form method="post" action={`${B}/start/done`}><Csrf c={c} /><button>{t("Finish", "마치기")}</button></form>
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
