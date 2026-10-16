/** @jsxImportSource hono/jsx */
import { Layout } from "./layout.js";
import { tr, type Lang } from "./ui.js";

export function consentPage(p: {
  v: { clientName: string; redirectHost: string };
  query: string;
  error?: string;
  needTotp: boolean;
  lang?: Lang;
}) {
  const t = tr(p.lang ?? "en");
  return (
    <Layout title={`${t("Authorize", "연결 허용")} · memexhub`} lang={p.lang}>
      <div class="card">
        <h1>{t("Connect to memexhub", "memexhub에 연결")}</h1>
        <p>
          <b>{p.v.clientName}</b> {t("wants to use your memexhub tools. After approval you will be sent back to", "앱이 memexhub 도구를 쓰려고 해요. 허용하면 이 주소로 돌아가요:")} <code>{p.v.redirectHost}</code>
        </p>
        <p class="muted">{t("Only approve if you just added memexhub as a connector yourself.", "방금 직접 memexhub를 커넥터로 추가한 경우에만 허용하세요.")}</p>
        {p.error && <p class="err" role="alert">{p.error}</p>}
        <form method="post" action="/authorize">
          <input type="hidden" name="query" value={p.query} />
          <label>{t("Admin username", "관리자 아이디")}<input name="username" autocomplete="username" required /></label>
          <label>{t("Password", "비밀번호")}<input name="password" type="password" autocomplete="current-password" required /></label>
          <label>{t("Authenticator code", "인증 앱 코드")}<span class="hint">{t("Only if two-factor is on.", "2단계 인증을 켠 경우에만.")}</span><input name="totp" inputmode="numeric" autocomplete="one-time-code" /></label>
          <div class="row">
            <button name="decision" value="allow" type="submit">{t("Allow", "허용")}</button>
            <button name="decision" value="deny" type="submit" class="secondary">{t("Deny", "거부")}</button>
          </div>
        </form>
      </div>
    </Layout>
  );
}
