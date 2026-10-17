import { useState } from "react";
import { post } from "../api";
import { ago, useT } from "../i18n";
import { CalendarDays, CloudSun, House, ListChecks, Mail, Map as MapIcon, MapPin, Music, NotebookText, Plug, Plus, type LucideIcon } from "lucide-react";
import { Actions, Badge, Button, Callout, Card, Check, Dialog, Empty, Input, Item, List, Loading, Page, Select, useAction, useConfirm, useData } from "../ui/kit";

type Text = { en: string; ko: string };
interface Item { id: string; kind: string; name: string; provider: string; providerTitle: Text; enabled: boolean; status: string | null; lastOkAt: string | null; lastError: string | null; email: string | null; signIn: string | null }
interface Field { key: string; label: string; type: "text" | "password" | "checkbox" | "number" | "select"; options?: string[]; optional: boolean; defaultValue?: unknown }
interface Form { key: string; kind: string; title: Text; fields: Field[]; secrets: Field[]; googleRedirect: string | null; signIn: string | null; reuse: { id: string; name: string; kind: string; account: string | null }[] }

/** Kinds in the order they are shown, with an icon, a name and what the connection is for. */
const KINDS: { kind: string; icon: LucideIcon; name: [string, string]; what: [string, string] }[] = [
  { kind: "calendar", icon: CalendarDays, name: ["Calendar", "캘린더"], what: ["Your events in summaries; Claude can look up any day. Read-only.", "일정을 요약에 넣고 Claude가 어느 날이든 찾아봐요. 읽기 전용."] },
  { kind: "mail", icon: Mail, name: ["Mail", "메일"], what: ["Claude can search and read your mailbox; receipts become payments. Read-only.", "Claude가 메일함을 찾고 읽고, 영수증은 결제로 기록돼요. 읽기 전용."] },
  { kind: "tasks", icon: ListChecks, name: ["Tasks", "할 일"], what: ["Claude can read and add to-dos.", "Claude가 할 일을 보고 추가해요."] },
  { kind: "location", icon: MapPin, name: ["Location", "위치"], what: ["Where you were, and place names for payments.", "다녀온 곳과 결제 장소 이름."] },
  { kind: "geocoder", icon: MapIcon, name: ["Place names", "지명"], what: ["Turns coordinates into neighbourhood names.", "좌표를 동네 이름으로 바꿔요."] },
  { kind: "maptiles", icon: MapIcon, name: ["Map background", "지도 바탕"], what: ["Pictures behind the route on the Map screen, fetched and kept by this server.", "지도 화면의 경로 뒤에 깔리는 지도. 이 서버가 받아 보관해요."] },
  { kind: "weather", icon: CloudSun, name: ["Weather", "날씨"], what: ["The day's weather at a place you choose.", "고른 장소의 그날 날씨."] },
  { kind: "home", icon: House, name: ["Home", "집"], what: ["Smart-home states and the day's logbook. Read-only: nothing is switched.", "스마트홈 상태와 그날 기록. 읽기 전용이라 아무것도 켜고 끄지 않아요."] },
  { kind: "music", icon: Music, name: ["Music", "음악"], what: ["What you listened to, for the journal. Read-only.", "들은 음악을 일지에. 읽기 전용."] },
  { kind: "notion", icon: NotebookText, name: ["Notion", "Notion"], what: ["Copies records into Notion databases.", "기록을 Notion 데이터베이스로 복사해요."] },
];
/** One line on what each service needs, shown under its full name. */
const NEEDS: Record<string, [string, string]> = {
  "calendar:google": ["Sign in with Google (an OAuth client from Google Cloud).", "Google로 로그인 (Google Cloud의 OAuth 클라이언트)."],
  "calendar:icloud": ["Apple ID and an app-specific password.", "Apple ID와 앱 암호."],
  "calendar:caldav": ["The CalDAV address, user name and password.", "CalDAV 주소, 아이디, 비밀번호."],
  "mail:imap": ["Mail server, user name and an app password.", "메일 서버, 아이디, 앱 비밀번호."],
  "tasks:google": ["Sign in with Google (an OAuth client from Google Cloud).", "Google로 로그인 (Google Cloud의 OAuth 클라이언트)."],
  "location:owntracks": ["The OwnTracks app sends to memexhub with a device token.", "OwnTracks 앱이 기기 토큰으로 memexhub에 보내요."],
  "location:dawarich": ["Your Dawarich server address and API key.", "Dawarich 서버 주소와 API 키."],
  "geocoder:nominatim": ["Nothing. The public OpenStreetMap server works.", "필요 없음. 공개 OpenStreetMap 서버를 써요."],
  "maptiles:osm": ["Nothing. The public OpenStreetMap tile server works.", "필요 없음. 공개 OpenStreetMap 지도 서버를 써요."],
  "weather:open-meteo": ["A place name and its latitude/longitude. No key.", "장소 이름과 위도·경도. 키 없음."],
  "home:home-assistant": ["The Home Assistant address and a long-lived token.", "홈 어시스턴트 주소와 장기 액세스 토큰."],
  "music:lastfm": ["Your Last.fm user name and an API key.", "Last.fm 사용자 이름과 API 키."],
  "music:spotify": ["A Spotify developer app, then Sign in with Spotify.", "Spotify 개발자 앱을 만든 뒤 Spotify로 로그인."],
  "notion:notion": ["An internal integration token, shared with your pages.", "페이지와 공유한 내부 통합 토큰."],
};

/**
 * Services that need a developer app of your own (Google Cloud / Spotify developer). Shown last with an
 * "Advanced" badge, and with the easier path when Claude already has its own connector for it.
 */
const ADVANCED: Record<string, [string, string] | null> = {
  "calendar:google": ["Only want Claude to see your Google Calendar? The Claude app's own Google Calendar connector is easier. Use this for several accounts or daily summaries.", "Claude가 구글 캘린더만 보면 된다면 Claude 앱의 Google Calendar 커넥터가 더 쉬워요. 여러 계정을 쓰거나 하루 요약에 넣을 때 쓰세요."],
  "tasks:google": null,
  "music:spotify": ["Last.fm is easier: a user name and an API key.", "Last.fm이 더 쉬워요: 사용자 이름과 API 키만 있으면 돼요."],
};

/** The name without the parenthesised or dashed extra ("IMAP mail (Kakao, …) — read-only" → "IMAP mail"); the rest is shown when it is opened. */
export const shortName = (title: string) => title.replace(/\s+[—-]\s+.*$/, "").replace(/\s*\([^)]*\)\s*$/, "").trim() || title;

export function Connections() {
  const { t, lang } = useT();
  const { data, error, reload } = useData<{ items: Item[]; addable: { key: string; kind: string; title: Text }[] }>("/connections");
  const { busy, run } = useAction();
  const [adding, setAdding] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [another, setAnother] = useState<Item | null>(null);
  const [editing, setEditing] = useState<Item | null>(null);
  const confirm = useConfirm();
  const [anotherName, setAnotherName] = useState("");
  if (!data) return <Page title={t("Connections", "연결")}><Loading error={error} reload={reload} /></Page>;
  const tx = (x: Text) => (lang === "ko" ? x.ko : x.en);
  const kindOf = (kind: string) => kinds.find((k) => k.kind === kind);
  const pick = adding ? data.addable.find((a) => a.key === adding) : undefined;
  const known = KINDS.map((k) => k.kind);
  const kinds = [...KINDS, ...[...new Set([...data.items, ...data.addable].map((x) => x.kind))].filter((k) => !known.includes(k)).map((k) => ({ kind: k, icon: Plug, name: [k, k] as [string, string], what: ["", ""] as [string, string] }))];
  const status = (x: Item) =>
    !x.enabled ? t("Off", "꺼짐") : x.status === "ok" ? t(`Working · checked ${ago(t, x.lastOkAt, "UTC")}`, `정상 · ${ago(t, x.lastOkAt, "UTC")} 확인`) : x.status === "error" ? <span className="text-destructive">{x.lastError}</span> : t("Checking soon", "곧 확인해요");
  const used = kinds.filter((k) => data.items.some((x) => x.kind === k.kind));
  return (
    <Page title={t("Connections", "연결")} sub={t("Services memexhub collects from. All optional.", "memexhub가 모아 오는 서비스예요. 모두 선택이에요.")}>
      <Card title={t(`Connected (${data.items.length})`, `연결된 것 (${data.items.length})`)}>
        {!data.items.length && <Empty>{t("Nothing connected yet. Pick a service below.", "아직 연결한 것이 없어요. 아래에서 골라 보세요.")}</Empty>}
        {used.map((k) => (
          <section key={k.kind} className="flex flex-col gap-3">
            <KindHeading icon={k.icon} name={t(...k.name)} />
            <List>
              {data.items.filter((x) => x.kind === k.kind).map((x) => (
                <Item key={x.id} tone={!x.enabled ? "idle" : x.status === "ok" ? "ok" : x.status === "error" ? "err" : "idle"}
                  title={shortName(tx(x.providerTitle))} badges={<Badge>{x.name}</Badge>}
                  meta={<>{status(x)}{x.email ? ` · ${x.email}` : ""}</>}
                  actions={<>
                    {x.signIn && x.email && <Button size="sm" kind="secondary" onClick={() => setAnother(x)}><Plus />{t("Add account", "계정 추가")}</Button>}
                    {x.signIn && <Button size="sm" kind={x.email ? "secondary" : "primary"} onClick={() => run(() => post<{ url: string }>(`/connections/${x.id}/signin`), undefined, (r) => void (location.href = r.url))}>{x.email ? t("Sign in again", "다시 로그인") : t(`Sign in with ${x.signIn}`, `${x.signIn}로 로그인`)}</Button>}
                    <Button kind="secondary" size="sm" onClick={() => setEditing(x)}>{t("Edit", "수정")}</Button>
                    {x.enabled && <Button kind="secondary" size="sm" busy={testing === x.id} onClick={async () => { setTesting(x.id); await run(() => post<{ ok: boolean; error?: string }>(`/connections/${x.id}/test`), (r) => (r.ok ? t("Working.", "정상이에요.") : t(`Failed: ${r.error}`, `실패: ${r.error}`)), reload); setTesting(null); }}>{t("Test", "시험")}</Button>}
                    <Button kind="ghost" size="sm" disabled={busy} onClick={() => run(() => post(`/connections/${x.id}/${x.enabled ? "disable" : "enable"}`), x.enabled ? t("Turned off.", "껐어요.") : t("Turned on.", "켰어요."), reload)}>{x.enabled ? t("Turn off", "끄기") : t("Turn on", "켜기")}</Button>
                    <Button kind="ghost" size="sm" disabled={busy} onClick={() => confirm(t(`Delete “${x.name}”? Its saved password or token is deleted too.`, `“${x.name}” 연결을 지울까요? 저장된 비밀번호·토큰도 같이 지워져요.`)) && run(() => post(`/connections/${x.id}/remove`), t("Deleted.", "지웠어요."), reload)}>{t("Delete", "삭제")}</Button>
                  </>} />
              ))}
            </List>
          </section>
        ))}
      </Card>
      <Card title={t("Add a connection", "연결 추가")} sub={t("Pick one to see what it needs.", "누르면 무엇이 필요한지 보여요.")}>
        {kinds.filter((k) => data.addable.some((a) => a.kind === k.kind)).map((k) => (
          <section key={k.kind} className="flex flex-col gap-2">
            <KindHeading icon={k.icon} name={t(...k.name)} />
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.addable.filter((a) => a.kind === k.kind).sort((x, y) => Number(x.key in ADVANCED) - Number(y.key in ADVANCED)).map((a) => (
                <button key={a.key} type="button" onClick={() => setAdding(a.key)} title={tx(a.title)} className="hover:bg-accent/60 flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm font-medium transition-colors">
                  <Plus className="text-muted-foreground size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 truncate">{shortName(tx(a.title))}</span>
                  {a.key in ADVANCED && <Badge>{t("Advanced", "고급")}</Badge>}
                </button>
              ))}
            </div>
          </section>
        ))}
      </Card>
      <Dialog open={!!another} onClose={() => setAnother(null)} title={t("Add another account", "다른 계정 추가")}
        sub={another ? t(`Uses the same ${another.signIn} app as “${another.name}”. Next you sign in with the other account.`, `“${another.name}”과 같은 ${another.signIn} 앱 설정을 써요. 다음 화면에서 다른 계정으로 로그인하세요.`) : undefined}>
        <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); if (another) void run(() => post<{ url: string }>(`/connections/${another.id}/another`, { name: anotherName }), undefined, (r) => void (location.href = r.url)); }}>
          <Input label={t("Name for the new account", "새 계정의 이름")} hint={t("e.g. work or family", "예: work, family")} value={anotherName} onChange={setAnotherName} required />
          <Actions><Button type="submit" busy={busy}>{t(`Continue to ${another?.signIn ?? ""}`, `${another?.signIn ?? ""} 로그인으로`)}</Button></Actions>
        </form>
      </Dialog>
      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing ? `${shortName(tx(editing.providerTitle))} · ${editing.name}` : ""}
        sub={t("Change what was wrong and save. Leave a password or token empty to keep the saved one.", "잘못된 걸 고치고 저장하세요. 비밀번호·토큰 칸을 비워 두면 저장된 값을 그대로 써요.")}>
        {editing && <EditForm id={editing.id} onDone={() => { setEditing(null); reload(); }} />}
      </Dialog>
      <Dialog open={!!adding} onClose={() => setAdding(null)} title={pick ? shortName(tx(pick.title)) : t("Add a connection", "연결 추가")} sub={pick && kindOf(pick.kind)?.what[0] ? t(...kindOf(pick.kind)!.what) : undefined}>
        {pick && (
          <div className="text-muted-foreground mb-5 space-y-1.5 text-sm">
            {shortName(tx(pick.title)) !== tx(pick.title) && <p>{tx(pick.title)}</p>}
            {NEEDS[pick.key] && <p><span className="text-foreground font-medium">{t("Needs", "필요한 것")}</span> · {t(...NEEDS[pick.key]!)}</p>}
            {ADVANCED[pick.key] && <Callout><p>💡 {t(...ADVANCED[pick.key]!)}</p></Callout>}
          </div>
        )}
        {adding && <AddForm provider={adding} onDone={() => { setAdding(null); reload(); }} />}
      </Dialog>
    </Page>
  );
}

function KindHeading(p: { icon: LucideIcon; name: string }) {
  return (
    <div className="flex items-center gap-2">
      <p.icon className="text-muted-foreground size-4" aria-hidden />
      <h3 className="text-sm font-semibold">{p.name}</h3>
    </div>
  );
}

/** Loads a saved connection (no secrets) and opens the same form, filled in. */
function EditForm({ id, onDone }: { id: string; onDone: () => void }) {
  const { data, error, reload } = useData<{ provider: string; name: string; config: Record<string, unknown> }>(`/connections/${id}`);
  return data ? <AddForm provider={data.provider} edit={data} onDone={onDone} /> : <Loading error={error} reload={reload} />;
}

function AddForm({ provider, onDone, edit }: { provider: string; onDone: () => void; edit?: { name: string; config: Record<string, unknown> } }) {
  const { t } = useT();
  const { data: form } = useData<Form>(`/connections/form?provider=${encodeURIComponent(provider)}`);
  const { busy, run } = useAction();
  const [name, setName] = useState(edit?.name ?? "");
  const [config, setConfig] = useState<Record<string, unknown>>(edit?.config ?? {});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [copyFrom, setCopyFrom] = useState<string>();
  if (!form) return <Loading />;
  const val = (f: Field) => (config[f.key] ?? f.defaultValue ?? (f.type === "checkbox" ? false : "")) as string | boolean;
  // An app already set up for this service (client ID + secret) is offered first; then only the account sign-in is left.
  const from = edit ? "" : copyFrom ?? form.reuse[0]?.id ?? "";
  const APP = ["clientId", "clientSecret"];
  const shown = (f: Field) => !(from && APP.includes(f.key));
  const KIND_NAME = Object.fromEntries(KINDS.map((k) => [k.kind, t(...k.name)]));
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => {
      e.preventDefault();
      const cfg = Object.fromEntries(form.fields.map((f) => [f.key, f.type === "number" ? (val(f) === "" ? undefined : Number(val(f))) : val(f)]));
      const save = () => post<{ id: string; test: { ok: boolean; error?: string } }>("/connections", { provider, name, config: Object.fromEntries(Object.entries(cfg).filter(([k]) => !from || !APP.includes(k))), secrets, ...(from ? { copyFrom: from } : {}) });
      // Services with a sign-in go straight to it after saving.
      if (form.signIn && !edit) void run(async () => (await post<{ url: string }>(`/connections/${(await save()).id}/signin`)).url, undefined, (url) => void (location.href = url));
      else void run(save, (r) => (r.test.ok ? t("Connected and working.", "연결했고 정상이에요.") : t(`Saved, but the test failed: ${r.test.error}`, `저장했지만 시험에 실패했어요: ${r.test.error}`)), onDone);
    }}>
      {edit ? null : <Input label={t("Name", "이름")} hint={t("Your own label, e.g. personal or work.", "구분용 이름이에요. 예: personal, work")} value={name} onChange={setName} required />}
      {!edit && form.reuse.length > 0 && (
        <Select label={t(`${form.signIn} app`, `${form.signIn} 앱 설정`)} hint={t("Use the client ID and secret you already entered, then just sign in with the other account.", "이미 넣은 Client ID·Secret을 그대로 쓰고, 다른 계정으로 로그인만 하면 돼요.")}
          value={from} onChange={setCopyFrom}
          options={[...form.reuse.map((r) => ({ value: r.id, label: t(`Same as ${r.name} (${KIND_NAME[r.kind] ?? r.kind}${r.account ? `, ${r.account}` : ""})`, `${r.name}과 같게 (${KIND_NAME[r.kind] ?? r.kind}${r.account ? `, ${r.account}` : ""})`) })), { value: "", label: t("Enter a new one", "새로 입력") }]} />
      )}
      {form.fields.filter(shown).map((f) =>
        f.type === "checkbox" ? (
          <Check key={f.key} checked={!!val(f)} onChange={(v) => setConfig({ ...config, [f.key]: v })} label={f.label} />
        ) : f.type === "select" ? (
          <Select key={f.key} label={f.label} value={String(val(f))} onChange={(v) => setConfig({ ...config, [f.key]: v })} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
        ) : (
          <Input key={f.key} label={`${f.label}${f.optional ? "" : " *"}`} value={String(val(f))} onChange={(v) => setConfig({ ...config, [f.key]: v })} inputMode={f.type === "number" ? "numeric" : undefined} required={!f.optional} />
        ),
      )}
      {form.secrets.filter(shown).map((f) => (
        <Input key={f.key} label={f.label} hint={edit ? t("Empty: keep the saved one.", "비워 두면 저장된 값을 그대로 써요.") : t("Stored encrypted and never shown again.", "암호화해 저장하고 다시 보여주지 않아요.")} type="password" value={secrets[f.key] ?? ""} onChange={(v) => setSecrets({ ...secrets, [f.key]: v })} autoComplete="new-password" />
      ))}
      {form.googleRedirect && !from && (
        <Callout>
          <p>{form.signIn === "Google"
            ? t("In Google Cloud create an OAuth client (Web application), enable the API (Google Tasks API or Google Calendar API) and add this redirect URI:", "Google Cloud에서 OAuth 클라이언트(웹 애플리케이션)를 만들고 API(Google Tasks API 또는 Google Calendar API)를 켠 뒤 이 리디렉션 URI를 추가하세요:")
            : t(`In the ${form.signIn} developer dashboard create an app and add this redirect URI:`, `${form.signIn} 개발자 대시보드에서 앱을 만들고 이 리디렉션 URI를 추가하세요:`)}</p>
          <code>{form.googleRedirect}</code>
          <p>{t(`Saving takes you to ${form.signIn} to sign in.`, `저장하면 ${form.signIn} 로그인으로 넘어가요.`)}</p>
        </Callout>
      )}
      <Actions><Button type="submit" busy={busy}>{form.signIn && !edit ? t(`Save and sign in with ${form.signIn}`, `저장하고 ${form.signIn}로 로그인`) : t("Save and test", "저장하고 시험")}</Button></Actions>
    </form>
  );
}
