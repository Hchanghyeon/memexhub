import { useState } from "react";
import { post } from "../api";
import { useT } from "../i18n";
import { checkText, type Check } from "../checks";
import { Badge, Button, Card, Copy, Dot, Loading, Page, Toggle, useAction, useData } from "../ui/kit";
import { TwoFactorSetup } from "./Auth";

interface S { checks: Check[]; totp: boolean; mcpAnthropicOnly: boolean; allowPublic: boolean; forcedPublic: boolean; adminUrl: string; protectedPaths: string[] }

export function Security() {
  const { t } = useT();
  const { data, error, reload } = useData<S>("/security");
  const { busy, run } = useAction();
  const [enrolling, setEnrolling] = useState(false);
  if (!data) return <Page title={t("Security", "보안")}><Loading error={error} reload={reload} /></Page>;
  return (
    <Page title={t("Security", "보안")}>
      <Card title={t("Checks", "점검")}>
        <ul className="list">
          {data.checks.map((c) => <li key={c.id}><Dot tone={c.ok ? "ok" : c.level === "high" ? "err" : "warn"} /><span className="grow">{checkText(t, c).text}</span></li>)}
        </ul>
      </Card>
      <Card title={t("Two-factor sign-in", "2단계 인증")} badge={<Badge tone="recommended">{t("Recommended", "추천")}</Badge>} sub={t("A code from an authenticator app on top of the password. Needed to open this page from outside.", "비밀번호에 더해 인증 앱의 코드를 넣어요. 밖에서 이 화면을 열려면 필요해요.")}>
        {data.totp ? <p className="ok">✓ {t("On", "켜져 있어요")}</p> : enrolling ? <TwoFactorSetup onDone={() => { setEnrolling(false); reload(); }} /> : <Button onClick={() => setEnrolling(true)}>{t("Turn on", "켜기")}</Button>}
      </Card>
      <Card title={t("Who may connect", "누가 접속할 수 있나")} badge={<Badge tone="recommended">{t("Recommended", "추천")}</Badge>}>
        <Toggle checked={data.mcpAnthropicOnly} disabled={busy} onChange={(v) => run(() => post("/mcp-allow", { enforce: v }), t("Saved.", "저장했어요."), reload)}
          label={t("Only Anthropic's servers", "Anthropic 서버만")} hint={t("The Claude apps always go through Anthropic. With this on, a leaked token cannot be used from anywhere else.", "Claude 앱은 늘 Anthropic 서버를 거쳐요. 켜면 토큰이 새도 다른 곳에서는 못 써요.")} />
        <Toggle checked={data.allowPublic || data.forcedPublic} disabled={busy || data.forcedPublic || (!data.totp && !data.allowPublic)} onChange={(v) => run(() => post("/admin-public", { enable: v }), v ? t("This page now opens from anywhere (with two-factor).", "이제 어디서나 이 화면을 열 수 있어요(2단계 인증 필요).") : t("Home network only again.", "다시 집 네트워크에서만 열려요."), reload)}
          label={t("Open this page from anywhere", "이 화면을 어디서나 열기")} hint={data.totp ? t("Signing in from outside needs the password and the authenticator code.", "밖에서 로그인할 때는 비밀번호와 인증 앱 코드가 필요해요.") : t("Turn on two-factor first.", "먼저 2단계 인증을 켜세요.")} />
        {(data.allowPublic || data.forcedPublic) && <Copy text={data.adminUrl} />}
      </Card>
      <Card title={t("Notes Claude may not change", "Claude가 못 고치는 노트")}>
        <div className="tags">{data.protectedPaths.map((p) => <code key={p}>{p}</code>)}</div>
        <p className="hint">{t("Change them under Vault → Wiki layout → rule notes.", "볼트 → 위키 구조 → 규칙 노트에서 바꿔요.")}</p>
      </Card>
    </Page>
  );
}
