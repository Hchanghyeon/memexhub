import { useState } from "react";
import { post } from "../api";
import { useT } from "../i18n";
import { checkText, type Check } from "../checks";
import { Badge, Button, Card, Copy, Item, List, Loading, Page, Status, TextArea, Toggle, useAction, useData } from "../ui/kit";
import { TwoFactorSetup } from "./Auth";

interface S { checks: Check[]; totp: boolean; mcpAnthropicOnly: boolean; allowPublic: boolean; forcedPublic: boolean; adminUrl: string; protectedPaths: string[]; readOnly: boolean }

export function Security() {
  const { t } = useT();
  const { data, error, reload } = useData<S>("/security");
  const { busy, run } = useAction();
  const [enrolling, setEnrolling] = useState(false);
  if (!data) return <Page title={t("Security", "보안")}><Loading error={error} reload={reload} /></Page>;
  const recommended = <Badge tone="recommended">{t("Recommended", "추천")}</Badge>;
  return (
    <Page title={t("Security", "보안")} sub={t("Who can sign in, who can connect, and what Claude may not change.", "누가 로그인하고 접속할 수 있는지, Claude가 무엇을 못 바꾸는지예요.")}>
      <Card title={t("Checks", "점검")}>
        <List>
          {data.checks.map((c) => <Item key={c.id} tone={c.ok ? "ok" : c.level === "high" ? "err" : "warn"} title={<span className="font-normal">{checkText(t, c).text}</span>} />)}
        </List>
      </Card>
      <Card title={t("Two-factor sign-in", "2단계 인증")} badge={recommended} sub={t("A code from an authenticator app on top of the password. Needed to open this page from outside.", "비밀번호에 더해 인증 앱의 코드를 넣어요. 밖에서 이 화면을 열려면 필요해요.")}>
        {data.totp ? <Status tone="ok">{t("On", "켜져 있어요")}</Status> : enrolling ? <TwoFactorSetup onDone={() => { setEnrolling(false); reload(); }} /> : <div><Button onClick={() => setEnrolling(true)}>{t("Turn on", "켜기")}</Button></div>}
      </Card>
      <Card title={t("Who may connect", "누가 접속할 수 있나")} badge={recommended}>
        <Toggle checked={data.mcpAnthropicOnly} disabled={busy} onChange={(v) => run(() => post("/mcp-allow", { enforce: v }), t("Saved.", "저장했어요."), reload)}
          label={t("Only Anthropic's servers", "Anthropic 서버만")} hint={t("The Claude apps always go through Anthropic. With this on, a leaked token cannot be used from anywhere else.", "Claude 앱은 늘 Anthropic 서버를 거쳐요. 켜면 토큰이 새도 다른 곳에서는 못 써요.")} />
        <Toggle checked={data.allowPublic || data.forcedPublic} disabled={busy || data.forcedPublic || (!data.totp && !data.allowPublic)} onChange={(v) => run(() => post("/admin-public", { enable: v }), v ? t("This page now opens from anywhere (with two-factor).", "이제 어디서나 이 화면을 열 수 있어요(2단계 인증 필요).") : t("Home network only again.", "다시 집 네트워크에서만 열려요."), reload)}
          label={t("Open this page from anywhere", "이 화면을 어디서나 열기")} hint={data.totp ? t("Signing in from outside needs the password and the authenticator code.", "밖에서 로그인할 때는 비밀번호와 인증 앱 코드가 필요해요.") : t("Turn on two-factor first.", "먼저 2단계 인증을 켜세요.")} />
        {(data.allowPublic || data.forcedPublic) && <Copy text={data.adminUrl} />}
      </Card>
      <VaultSafety s={data} reload={reload} />
    </Page>
  );
}

function VaultSafety({ s, reload }: { s: S; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [paths, setPaths] = useState(s.protectedPaths.join("\n"));
  const save = (readOnly: boolean) => run(() => post("/vault-safety", { readOnly, protectedPaths: paths.split("\n").map((x) => x.trim()).filter(Boolean) }), t("Saved.", "저장했어요."), reload);
  return (
    <Card title={t("What Claude may change", "Claude가 바꿀 수 있는 것")} footer={<Button busy={busy} onClick={() => void save(s.readOnly)}>{t("Save", "저장")}</Button>}>
      <Toggle checked={s.readOnly} disabled={busy} onChange={(on) => void save(on)} label={t("Read-only vault", "볼트 읽기 전용")}
        hint={t("Claude can read and search but not write. Payments and other records still arrive, but notes are not updated.", "Claude는 읽고 찾기만 하고 쓰지 못해요. 결제 같은 기록은 계속 받지만 노트는 고쳐지지 않아요.")} />
      <TextArea label={t("Notes Claude may not change", "Claude가 못 고치는 노트")} hint={t("One per line; * matches within a folder, ** across folders; relative to the vault. Rule notes from Vault → Wiki layout are protected too.", "한 줄에 하나. *는 폴더 안, **는 하위 폴더까지, 볼트 안의 상대 경로로. 볼트 → 위키 구조의 규칙 노트도 함께 보호돼요.")}
        value={paths} onChange={setPaths} rows={5} mono />
    </Card>
  );
}
