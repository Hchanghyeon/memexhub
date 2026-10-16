import { post } from "../api";
import { ago, useT, when } from "../i18n";
import { Badge, Button, Card, Copy, Empty, Field, Item, List, Loading, Page, Segmented, Steps, Tags, Toggle, useAction, useConfirm, useData } from "../ui/kit";

interface C { url: string; clients: { id: string; name: string; createdAt: string; lastUsed: string | null; revoked: boolean }[]; tools: { name: string; readOnly: boolean; destructive: boolean }[]; toolLanguage: "en" | "ko" | "both"; destructive: { name: string; description: { en: string; ko: string }; enabled: boolean }[] }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Claude() {
  const { t, lang } = useT();
  const { data, error, reload } = useData<C>("/claude");
  const { busy, run } = useAction();
  const confirm = useConfirm();
  if (!data) return <Page title={t("Claude app", "Claude 앱")}><Loading error={error} reload={reload} /></Page>;
  const active = data.clients.filter((c) => !c.revoked);
  return (
    <Page title={t("Use memexhub in Claude", "Claude에서 memexhub 쓰기")} sub={t("Add memexhub to the Claude app as a connector once. Then Claude can read and write your notes and see your records when you ask.", "Claude 앱에 memexhub를 커넥터로 한 번만 추가하세요. 그러면 물어볼 때 Claude가 노트를 읽고 쓰고, 기록도 볼 수 있어요.")}>
      <Card title={t("How to add it", "추가하는 방법")} badge={<Badge tone="required">{t("Required", "필수")}</Badge>}>
        <Steps>
          {[
            <p key="1">{t("Open the Claude app or claude.ai → Settings → Connectors.", "Claude 앱이나 claude.ai → 설정 → 커넥터를 여세요.")}</p>,
            <div key="2" className="space-y-2"><p>{t("Add custom connector. Name: memexhub. Address:", "사용자 지정 커넥터 추가. 이름: memexhub. 주소:")}</p><Copy text={data.url} /></div>,
            <p key="3">{t("A memexhub sign-in page opens. Sign in with this admin account and press Allow.", "memexhub 로그인 화면이 열려요. 이 관리자 계정으로 로그인하고 허용을 누르세요.")}</p>,
            <p key="4">{t("Try it: “What did I spend today?” or “Summarise my week.”", "써 보기: “오늘 얼마 썼어?”, “이번 주 정리해 줘.”")}</p>,
          ]}
        </Steps>
      </Card>
      <Card title={t("Signed-in apps", "로그인한 앱")} sub={t("Each phone, desktop app or browser that added the connector.", "커넥터를 추가한 폰, 데스크톱 앱, 브라우저마다 하나씩이에요.")}>
        {active.length ? (
          <List>
            {active.map((c) => (
              <Item key={c.id} tone={c.lastUsed ? "ok" : "idle"} title={c.name}
                meta={t(`Last used ${ago(t, c.lastUsed, tz)} · added ${when(c.createdAt, tz)}`, `마지막 사용 ${ago(t, c.lastUsed, tz)} · 추가 ${when(c.createdAt, tz)}`)}
                actions={<Button kind="secondary" size="sm" disabled={busy} onClick={() => confirm(t("Revoke this app? It has to sign in again.", "이 앱을 해제할까요? 다시 로그인해야 해요.")) && run(() => post(`/claude/${c.id}/revoke`), t("Revoked.", "해제했어요."), reload)}>{t("Revoke", "해제")}</Button>} />
            ))}
          </List>
        ) : <Empty>{t("No app has signed in yet.", "아직 로그인한 앱이 없어요.")}</Empty>}
      </Card>
      <Card title={t("What Claude can do", "Claude가 할 수 있는 일")} sub={t(`${data.tools.length} tools. Tools that delete or move notes are hidden unless switched on.`, `도구 ${data.tools.length}개. 노트를 지우거나 옮기는 도구는 따로 켜야만 보여요.`)}>
        <Tags>{data.tools.map((x) => <Badge key={x.name} tone={x.destructive ? "required" : "neutral"}>{x.name}</Badge>)}</Tags>
        <Field label={t("Language Claude sees for tool descriptions", "Claude가 보는 도구 설명 언어")}>
          <Segmented value={data.toolLanguage} onChange={(v) => run(() => post("/claude/language", { toolLanguage: v }), t("Saved.", "저장했어요."), reload)} options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }, { value: "both", label: t("Both", "둘 다") }]} />
        </Field>
      </Card>
      {data.destructive.length > 0 && (
        <Card title={t("Tools that move or delete notes", "노트를 옮기거나 지우는 도구")} badge={<Badge>{t("Optional", "선택")}</Badge>} sub={t("Off by default. Deleted notes go to .trash/ and can be brought back.", "기본은 꺼져 있어요. 지운 노트는 .trash/로 가서 되살릴 수 있어요.")}>
          {data.destructive.map((x) => (
            <Toggle key={x.name} checked={x.enabled} disabled={busy} onChange={(on) => run(() => post("/claude/destructive", { name: x.name, enabled: on }), on ? t("Claude can use it now.", "이제 Claude가 쓸 수 있어요.") : t("Hidden from Claude.", "Claude에게서 숨겼어요."), reload)}
              label={<code>{x.name}</code>} hint={lang === "ko" ? x.description.ko : x.description.en} />
          ))}
        </Card>
      )}
    </Page>
  );
}
