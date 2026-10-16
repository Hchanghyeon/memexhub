import { post } from "../api";
import { ago, useT, when } from "../i18n";
import { Badge, Button, Card, Copy, Dot, Empty, Loading, Page, Segmented, useAction, useConfirm, useData } from "../ui/kit";

interface C { url: string; clients: { id: string; name: string; createdAt: string; lastUsed: string | null; revoked: boolean }[]; tools: { name: string; readOnly: boolean; destructive: boolean }[]; toolLanguage: "en" | "ko" | "both" }

export function Claude() {
  const { t } = useT();
  const { data, error, reload } = useData<C>("/claude");
  const { busy, run } = useAction();
  const confirm = useConfirm();
  if (!data) return <Page title={t("Claude app", "Claude 앱")}><Loading error={error} reload={reload} /></Page>;
  const active = data.clients.filter((c) => !c.revoked);
  return (
    <Page title={t("Use memexhub in Claude", "Claude에서 memexhub 쓰기")} sub={t("Add memexhub to the Claude app as a connector once. Then Claude can read and write your notes and see your records when you ask.", "Claude 앱에 memexhub를 커넥터로 한 번만 추가하세요. 그러면 물어볼 때 Claude가 노트를 읽고 쓰고, 기록도 볼 수 있어요.")}>
      <Card title={t("How to add it", "추가하는 방법")} badge={<Badge tone="required">{t("Required", "필수")}</Badge>}>
        <ol className="steps">
          <li>{t("Open the Claude app or claude.ai → Settings → Connectors.", "Claude 앱이나 claude.ai → 설정 → 커넥터를 여세요.")}</li>
          <li>{t("Add custom connector. Name: memexhub. Address:", "사용자 지정 커넥터 추가. 이름: memexhub. 주소:")}<Copy text={data.url} /></li>
          <li>{t("A memexhub sign-in page opens. Sign in with this admin account and press Allow.", "memexhub 로그인 화면이 열려요. 이 관리자 계정으로 로그인하고 허용을 누르세요.")}</li>
          <li>{t("Try it: “What did I spend today?” or “Summarise my week.”", "써 보기: “오늘 얼마 썼어?”, “이번 주 정리해 줘.”")}</li>
        </ol>
      </Card>
      <Card title={t("Signed-in apps", "로그인한 앱")} sub={t("Each phone, desktop app or browser that added the connector.", "커넥터를 추가한 폰, 데스크톱 앱, 브라우저마다 하나씩이에요.")}>
        {active.length ? (
          <ul className="list">
            {active.map((c) => (
              <li key={c.id}>
                <Dot tone={c.lastUsed ? "ok" : "idle"} />
                <div className="grow"><span className="title">{c.name}</span><span className="meta">{t(`Last used ${ago(t, c.lastUsed, "UTC")} · added ${when(c.createdAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}`, `마지막 사용 ${ago(t, c.lastUsed, "UTC")} · 추가 ${when(c.createdAt, Intl.DateTimeFormat().resolvedOptions().timeZone)}`)}</span></div>
                <Button kind="secondary" size="sm" disabled={busy} onClick={() => confirm(t("Revoke this app? It has to sign in again.", "이 앱을 해제할까요? 다시 로그인해야 해요.")) && run(() => post(`/claude/${c.id}/revoke`), t("Revoked.", "해제했어요."), reload)}>{t("Revoke", "해제")}</Button>
              </li>
            ))}
          </ul>
        ) : <Empty>{t("No app has signed in yet.", "아직 로그인한 앱이 없어요.")}</Empty>}
      </Card>
      <Card title={t(`What Claude can do (${data.tools.length} tools)`, `Claude가 할 수 있는 일 (도구 ${data.tools.length}개)`)}>
        <div className="tags">{data.tools.map((x) => <Badge key={x.name} tone={x.destructive ? "required" : "neutral"}>{x.name}</Badge>)}</div>
        <div className="field" style={{ marginTop: "1rem" }}>
          <label>{t("Language Claude sees for tool descriptions", "Claude가 보는 도구 설명 언어")}</label>
          <Segmented value={data.toolLanguage} onChange={(v) => run(() => post("/claude/language", { toolLanguage: v }), t("Saved.", "저장했어요."), reload)} options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }, { value: "both", label: t("Both", "둘 다") }]} />
        </div>
        <p className="hint">{t("Tools that delete or move notes are hidden unless switched on.", "노트를 지우거나 옮기는 도구는 따로 켜야만 보여요.")}</p>
      </Card>
    </Page>
  );
}
