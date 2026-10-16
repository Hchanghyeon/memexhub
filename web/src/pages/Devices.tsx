import { useState } from "react";
import { post } from "../api";
import { ago, useT } from "../i18n";
import { Badge, Button, Card, Copy, Dot, Empty, Input, Loading, Page, useAction, useConfirm, useData } from "../ui/kit";

interface D { tokens: { id: string; name: string; scopes: string[]; createdAt: string; lastUsed: string | null; revoked: boolean }[]; publicUrl: string }
const SCOPES: [string, string, string, string, string][] = [
  ["ledger", "Payments", "결제", "card messages, Apple Pay", "카드 문자, Apple Pay"],
  ["health", "Health", "건강", "sleep, steps, workouts", "수면, 걸음, 운동"],
  ["location", "Location", "위치", "the OwnTracks app", "OwnTracks 앱"],
  ["dav", "Vault sync", "볼트 동기화", "Obsidian on your devices", "기기의 Obsidian"],
];

export function Devices() {
  const { t } = useT();
  const { data, error, reload } = useData<D>("/devices");
  const { busy, run } = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState(["ledger", "health", "location"]);
  const [fresh, setFresh] = useState<string>();
  if (!data) return <Page title={t("Devices", "기기")}><Loading error={error} reload={reload} /></Page>;
  const scopeName = (s: string) => {
    const x = SCOPES.find((y) => y[0] === s);
    return x ? t(x[1], x[2]) : s;
  };
  const tokens = data.tokens.filter((x) => !x.revoked);
  return (
    <Page title={t("Devices", "기기")} sub={t("Phones and apps that send records (payments, health, location) use a device token. A token can only send, never read.", "기록(결제, 건강, 위치)을 보내는 폰과 앱은 기기 토큰을 써요. 토큰은 보내기만 하고 읽지는 못해요.")}>
      {fresh && (
        <Card title={t("Your new token", "새 토큰")} className="fresh">
          <p className="callout warn">{t("Copy it now — it will not be shown again.", "지금 복사하세요. 다시 보여주지 않아요.")}</p>
          <Copy text={fresh} />
          <Button kind="secondary" size="sm" onClick={() => setFresh(undefined)}>{t("Done", "다 했어요")}</Button>
        </Card>
      )}
      <Card title={t("Tokens", "토큰")}>
        {tokens.length ? (
          <ul className="list">
            {tokens.map((x) => (
              <li key={x.id}>
                <Dot tone={x.lastUsed ? "ok" : "idle"} />
                <div className="grow"><span className="title">{x.name}</span> {x.scopes.map((s) => <Badge key={s}>{scopeName(s)}</Badge>)}<span className="meta">{t(`Last sent ${ago(t, x.lastUsed, "UTC")}`, `마지막 수신 ${ago(t, x.lastUsed, "UTC")}`)}</span></div>
                <Button kind="secondary" size="sm" disabled={busy} onClick={() => confirm(t(`Revoke “${x.name}”? Devices using it stop working.`, `“${x.name}”을 해제할까요? 이 토큰을 쓰는 기기는 멈춰요.`)) && run(() => post(`/devices/${x.id}/revoke`), t("Revoked.", "해제했어요."), reload)}>{t("Revoke", "해제")}</Button>
              </li>
            ))}
          </ul>
        ) : <Empty>{t("No tokens yet.", "아직 토큰이 없어요.")}</Empty>}
      </Card>
      <Card title={t("Create a token", "토큰 만들기")}>
        <form onSubmit={(e) => { e.preventDefault(); void run(() => post<{ token: string }>("/devices", { name, scopes }), t("Token created.", "토큰을 만들었어요."), (r) => { setFresh(r.token); setName(""); reload(); }); }}>
          <Input label={t("Name", "이름")} hint={t("Which device or app, e.g. iPhone shortcuts.", "어떤 기기·앱인지. 예: 아이폰 단축어")} value={name} onChange={setName} required />
          <div className="field">
            <label>{t("May send", "보낼 수 있는 것")}</label>
            {SCOPES.map(([id, en, ko, hen, hko]) => (
              <label key={id} className="check"><input type="checkbox" checked={scopes.includes(id)} onChange={(e) => setScopes(e.target.checked ? [...scopes, id] : scopes.filter((s) => s !== id))} /><span><b>{t(en, ko)}</b> <span className="muted">— {t(hen, hko)}</span></span></label>
            ))}
          </div>
          <Button type="submit" busy={busy} disabled={!scopes.length || !name.trim()}>{t("Create token", "토큰 만들기")}</Button>
        </form>
      </Card>
      <Card title={t("Where to send", "보내는 주소")} sub={t("Put the token in the X-Ingest-Token header, or use it as the password of a sign-in (any username).", "토큰은 X-Ingest-Token 헤더에 넣거나, 로그인 비밀번호로 쓰세요(아이디는 아무거나).")}>
        <table className="table"><tbody>
          <tr><th>{t("Card message, notification", "카드 문자, 알림")}</th><td><code>{data.publicUrl}/ingest/message</code></td></tr>
          <tr><th>{t("Wallet payment", "지갑 결제")}</th><td><code>{data.publicUrl}/ingest/transaction</code></td></tr>
          <tr><th>{t("Health day", "건강 기록")}</th><td><code>{data.publicUrl}/ingest/health</code></td></tr>
          <tr><th>{t("Location (OwnTracks)", "위치 (OwnTracks)")}</th><td><code>{data.publicUrl}/ingest/owntracks</code></td></tr>
        </tbody></table>
      </Card>
    </Page>
  );
}
