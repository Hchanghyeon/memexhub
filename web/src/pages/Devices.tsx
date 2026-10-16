import { useState } from "react";
import { post } from "../api";
import { ago, useT } from "../i18n";
import { Badge, Button, Callout, Card, Check, Copy, Empty, Field, Hint, Input, Item, KeyValue, List, Loading, Page, QrCode, Steps, Sub, useAction, useConfirm, useData } from "../ui/kit";

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
        <Card title={t("Your new token", "새 토큰")} className="border-primary/50 ring-primary/10 ring-4" footer={<Button kind="secondary" onClick={() => setFresh(undefined)}>{t("Done", "다 했어요")}</Button>}>
          <Callout tone="warning"><p>{t("Copy it now — it will not be shown again.", "지금 복사하세요. 다시 보여주지 않아요.")}</p></Callout>
          <Copy text={fresh} />
        </Card>
      )}
      <PhoneSetup publicUrl={data.publicUrl} onCreated={reload} />
      <Card title={t("Tokens", "토큰")}>
        {tokens.length ? (
          <List>
            {tokens.map((x) => (
              <Item key={x.id} tone={x.lastUsed ? "ok" : "idle"} title={x.name} badges={x.scopes.map((s) => <Badge key={s}>{scopeName(s)}</Badge>)}
                meta={t(`Last sent ${ago(t, x.lastUsed, "UTC")}`, `마지막 수신 ${ago(t, x.lastUsed, "UTC")}`)}
                actions={<Button kind="secondary" size="sm" disabled={busy} onClick={() => confirm(t(`Revoke “${x.name}”? Devices using it stop working.`, `“${x.name}”을 해제할까요? 이 토큰을 쓰는 기기는 멈춰요.`)) && run(() => post(`/devices/${x.id}/revoke`), t("Revoked.", "해제했어요."), reload)}>{t("Revoke", "해제")}</Button>} />
            ))}
          </List>
        ) : <Empty>{t("No tokens yet.", "아직 토큰이 없어요.")}</Empty>}
      </Card>
      <Card title={t("Create a token", "토큰 만들기")} onSubmit={() => void run(() => post<{ token: string }>("/devices", { name, scopes }), t("Token created.", "토큰을 만들었어요."), (r) => { setFresh(r.token); setName(""); reload(); })}
        footer={<Button type="submit" busy={busy} disabled={!scopes.length || !name.trim()}>{t("Create token", "토큰 만들기")}</Button>}>
        <Input label={t("Name", "이름")} hint={t("Which device or app, e.g. iPhone shortcuts.", "어떤 기기·앱인지. 예: 아이폰 단축어")} value={name} onChange={setName} required />
        <Field label={t("May send", "보낼 수 있는 것")}>
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            {SCOPES.map(([id, en, ko, hen, hko]) => (
              <Check key={id} checked={scopes.includes(id)} onChange={(on) => setScopes(on ? [...scopes, id] : scopes.filter((s) => s !== id))} label={t(en, ko)} hint={t(hen, hko)} />
            ))}
          </div>
        </Field>
      </Card>
      <Card title={t("Where to send", "보내는 주소")} sub={t("Put the token in the X-Ingest-Token header, or use it as the password of a sign-in (any username).", "토큰은 X-Ingest-Token 헤더에 넣거나, 로그인 비밀번호로 쓰세요(아이디는 아무거나).")}>
        <KeyValue rows={[
          [t("Card message, notification", "카드 문자, 알림"), <code>{data.publicUrl}/ingest/message</code>],
          [t("Wallet payment", "지갑 결제"), <code>{data.publicUrl}/ingest/transaction</code>],
          [t("Health day", "건강 기록"), <code>{data.publicUrl}/ingest/health</code>],
          [t("Location (OwnTracks)", "위치 (OwnTracks)"), <code>{data.publicUrl}/ingest/owntracks</code>],
        ]} />
      </Card>
    </Page>
  );
}

/** OwnTracks reads its whole configuration from this link (or the same link as a QR code). */
export function owntracksLink(publicUrl: string, token: string) {
  const conf = {
    _type: "configuration",
    mode: 3, // HTTP
    url: `${publicUrl}/ingest/owntracks`,
    auth: true,
    username: "memexhub",
    password: token,
    tid: "me",
    monitoring: 2, // "Move": a point every ~100 m while moving, for a route on the Map screen
    locatorDisplacement: 100,
  };
  const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(conf))));
  return `owntracks:///config?inline=${encodeURIComponent(b64)}`;
}

/** The two phone setups most people want, each a token plus one scan or one copy. */
function PhoneSetup({ publicUrl, onCreated }: { publicUrl: string; onCreated: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [loc, setLoc] = useState<string>();
  const [card, setCard] = useState<string>();
  const make = (name: string, scopes: string[], set: (v: string) => void) =>
    run(() => post<{ token: string }>("/devices", { name, scopes }), undefined, (r) => { set(r.token); onCreated(); });
  return (
    <Card title={t("Set up your phone", "폰 설정")} sub={t("Each setup makes its own token. Do it on this screen, then pick up your phone.", "설정마다 토큰을 하나씩 만들어요. 이 화면을 띄워 두고 폰을 들어 주세요.")}>
      <Sub>{t("Location — OwnTracks app", "위치 — OwnTracks 앱")}</Sub>
        {!loc ? (
          <>
            <Hint>{t("Where you go, for summaries and the Map screen. One scan sets up the app.", "다녀온 곳을 요약과 지도 화면에 써요. QR 한 번이면 앱 설정이 끝나요.")}</Hint>
            <div><Button busy={busy} onClick={() => void make("OwnTracks", ["location"], setLoc)}>{t("Make the setup QR", "설정 QR 만들기")}</Button></div>
          </>
        ) : (
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
            <QrCode text={owntracksLink(publicUrl, loc)} label={t("OwnTracks setup QR code", "OwnTracks 설정 QR 코드")} />
            <Steps>
              {[
                <p key="1">{t("Install OwnTracks (App Store / Google Play).", "OwnTracks를 설치하세요 (App Store / Google Play).")}</p>,
                <p key="2">{t("Scan this QR with the phone camera and open it in OwnTracks. On the phone itself, tap the link below instead.", "폰 카메라로 이 QR을 찍고 OwnTracks로 여세요. 폰에서 이 화면을 보고 있다면 아래 링크를 누르세요.")}</p>,
                <p key="3">{t("Allow location “Always”. The first points arrive within minutes.", "위치 권한을 “항상”으로 허용하세요. 몇 분 안에 첫 기록이 들어와요.")}</p>,
                <a key="4" href={owntracksLink(publicUrl, loc)} className="text-sm font-medium underline">{t("Open in OwnTracks", "OwnTracks에서 열기")}</a>,
              ]}
            </Steps>
          </div>
        )}
      <Sub>{t("Card payments — iPhone Shortcuts", "카드 결제 — 아이폰 단축어")}</Sub>
        {!card ? (
          <>
            <Hint>{t("Card company texts become payments. A Shortcuts automation forwards each message.", "카드사 문자가 결제 기록이 돼요. 단축어 자동화가 문자를 하나씩 보내요.")}</Hint>
            <div><Button kind="secondary" busy={busy} onClick={() => void make("Card messages", ["ledger"], setCard)}>{t("Make a token for Shortcuts", "단축어용 토큰 만들기")}</Button></div>
          </>
        ) : (
          <Steps>
            {[
              <p key="1">{t("Shortcuts → Automation → New → Message → “Message contains” 승인 (your card company's sender) → Run immediately.", "단축어 → 자동화 → 새로 만들기 → 메시지 → “메시지에 포함” 승인 (카드사 발신번호) → 즉시 실행.")}</p>,
              <div key="2" className="space-y-2"><p>{t("Add “Get contents of URL”: method POST, this address:", "“URL의 콘텐츠 가져오기”를 추가하고 방법 POST, 주소는:")}</p><Copy text={`${publicUrl}/ingest/message`} /></div>,
              <div key="3" className="space-y-2"><p>{t("Header X-Ingest-Token with this token (shown once):", "헤더 X-Ingest-Token 에 이 토큰 (한 번만 보여요):")}</p><Copy text={card} /></div>,
              <p key="4">{t("Body JSON: text = Shortcut Input. Messages it cannot read wait in Recipes & inbox.", "본문 JSON: text = 단축어 입력. 못 읽은 문자는 레시피·대기함에서 기다려요.")}</p>,
            ]}
          </Steps>
        )}
    </Card>
  );
}
