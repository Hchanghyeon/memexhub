import { useState } from "react";
import { post } from "../api";
import { ago, useT } from "../i18n";
import { Plus } from "lucide-react";
import { Actions, Badge, Button, Callout, Card, Check, Dialog, Empty, Input, Item, List, Loading, Page, Select, Tile, Tiles, useAction, useData } from "../ui/kit";

type Text = { en: string; ko: string };
interface Item { id: string; kind: string; name: string; provider: string; enabled: boolean; status: string | null; lastOkAt: string | null; lastError: string | null; email: string | null }
interface Field { key: string; label: string; type: "text" | "password" | "checkbox" | "number" | "select"; options?: string[]; optional: boolean; defaultValue?: unknown }
interface Form { key: string; kind: string; title: Text; fields: Field[]; secrets: Field[]; googleRedirect: string | null }

const KIND: Record<string, [string, string, string, string]> = {
  mail: ["Mail", "메일", "Claude can search and read your mailbox (read-only).", "Claude가 메일함을 찾고 읽어요 (읽기 전용)."],
  location: ["Location", "위치", "Where you were; place names for payments.", "다녀온 곳, 결제 장소 이름."],
  geocoder: ["Place names", "지명", "Turns coordinates into area names.", "좌표를 동네 이름으로 바꿔요."],
  tasks: ["Tasks", "할 일", "Claude can read and add tasks.", "Claude가 할 일을 보고 추가해요."],
  notion: ["Notion", "Notion", "Copy records into Notion.", "기록을 Notion으로 복사해요."],
  calendar: ["Calendar", "캘린더", "Read your events (read-only).", "일정을 읽어요 (읽기 전용)."],
  home: ["Home", "집", "Smart-home states and history (read-only).", "스마트홈 상태와 기록 (읽기 전용)."],
  weather: ["Weather", "날씨", "The day's weather at a place you choose.", "고른 장소의 그날 날씨."],
};

export function Connections() {
  const { t, lang } = useT();
  const { data, error, reload } = useData<{ items: Item[]; addable: { key: string; kind: string; title: Text }[] }>("/connections");
  const { busy, run } = useAction();
  const [adding, setAdding] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  if (!data) return <Page title={t("Connections", "연결")}><Loading error={error} reload={reload} /></Page>;
  const kind = (k: string) => (KIND[k] ? t(KIND[k]![0], KIND[k]![1]) : k);
  return (
    <Page title={t("Connections", "연결")} sub={t("Outside services memexhub reads for you. All optional — connect only what you want Claude to see.", "memexhub가 대신 읽어 오는 바깥 서비스예요. 모두 선택이에요. Claude가 볼 것만 연결하세요.")}>
      <Card title={t("Connected", "연결된 것")}>
        {data.items.length ? (
          <List>
            {data.items.map((x) => (
              <Item key={x.id} tone={!x.enabled ? "idle" : x.status === "ok" ? "ok" : x.status === "error" ? "err" : "idle"}
                title={x.name} badges={<><Badge>{kind(x.kind)}</Badge><Badge>{x.provider}</Badge></>}
                meta={<>{!x.enabled ? t("Off", "꺼짐") : x.status === "ok" ? t(`Working · checked ${ago(t, x.lastOkAt, "UTC")}`, `정상 · ${ago(t, x.lastOkAt, "UTC")} 확인`) : x.status === "error" ? <span className="text-destructive">{x.lastError}</span> : t("Not tested yet", "아직 시험 안 함")}{x.email ? ` · ${x.email}` : ""}</>}
                actions={<>
                  {x.provider === "google" && <Button size="sm" onClick={() => run(() => post<{ url: string }>(`/connections/${x.id}/google`), undefined, (r) => void (location.href = r.url))}>{x.email ? t("Sign in again", "다시 로그인") : t("Sign in with Google", "Google로 로그인")}</Button>}
                  {x.enabled && <Button kind="secondary" size="sm" busy={testing === x.id} onClick={async () => { setTesting(x.id); await run(() => post<{ ok: boolean; error?: string }>(`/connections/${x.id}/test`), (r) => (r.ok ? t("Working.", "정상이에요.") : t(`Failed: ${r.error}`, `실패: ${r.error}`)), reload); setTesting(null); }}>{t("Test", "시험")}</Button>}
                  <Button kind="ghost" size="sm" disabled={busy} onClick={() => run(() => post(`/connections/${x.id}/${x.enabled ? "disable" : "enable"}`), x.enabled ? t("Turned off.", "껐어요.") : t("Turned on.", "켰어요."), reload)}>{x.enabled ? t("Turn off", "끄기") : t("Turn on", "켜기")}</Button>
                </>} />
            ))}
          </List>
        ) : <Empty>{t("Nothing connected yet.", "아직 연결한 것이 없어요.")}</Empty>}
      </Card>
      <Card title={t("Add a connection", "연결 추가")} sub={t("Pick a service. You can test it before saving.", "서비스를 고르세요. 저장하면서 바로 시험해요.")}>
        <Tiles>
          {data.addable.map((a) => (
            <Tile key={a.key} onClick={() => setAdding(a.key)} label={<span className="inline-flex items-center gap-1"><Plus className="size-3.5" />{kind(a.kind)}</span>} value={lang === "ko" ? a.title.ko : a.title.en} sub={KIND[a.kind] ? t(KIND[a.kind]![2], KIND[a.kind]![3]) : undefined} />
          ))}
        </Tiles>
      </Card>
      <Dialog open={!!adding} onClose={() => setAdding(null)} title={t("Add a connection", "연결 추가")} sub={adding ? data.addable.find((a) => a.key === adding)?.title[lang === "ko" ? "ko" : "en"] : undefined}>
        {adding && <AddForm provider={adding} onDone={() => { setAdding(null); reload(); }} />}
      </Dialog>
    </Page>
  );
}

function AddForm({ provider, onDone }: { provider: string; onDone: () => void }) {
  const { t } = useT();
  const { data: form } = useData<Form>(`/connections/form?provider=${encodeURIComponent(provider)}`);
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  if (!form) return <Loading />;
  const val = (f: Field) => (config[f.key] ?? f.defaultValue ?? (f.type === "checkbox" ? false : "")) as string | boolean;
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => {
      e.preventDefault();
      const cfg = Object.fromEntries(form.fields.map((f) => [f.key, f.type === "number" ? (val(f) === "" ? undefined : Number(val(f))) : val(f)]));
      void run(() => post<{ id: string; test: { ok: boolean; error?: string } }>("/connections", { provider, name, config: cfg, secrets }), (r) => (r.test.ok ? t("Connected and working.", "연결했고 정상이에요.") : t(`Saved, but the test failed: ${r.test.error}`, `저장했지만 시험에 실패했어요: ${r.test.error}`)), onDone);
    }}>
      <Input label={t("Name", "이름")} hint={t("Your own label, e.g. personal or work.", "구분용 이름이에요. 예: personal, work")} value={name} onChange={setName} required />
      {form.fields.map((f) =>
        f.type === "checkbox" ? (
          <Check key={f.key} checked={!!val(f)} onChange={(v) => setConfig({ ...config, [f.key]: v })} label={f.label} />
        ) : f.type === "select" ? (
          <Select key={f.key} label={f.label} value={String(val(f))} onChange={(v) => setConfig({ ...config, [f.key]: v })} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
        ) : (
          <Input key={f.key} label={`${f.label}${f.optional ? "" : " *"}`} value={String(val(f))} onChange={(v) => setConfig({ ...config, [f.key]: v })} inputMode={f.type === "number" ? "numeric" : undefined} required={!f.optional} />
        ),
      )}
      {form.secrets.map((f) => (
        <Input key={f.key} label={f.label} hint={t("Stored encrypted and never shown again.", "암호화해 저장하고 다시 보여주지 않아요.")} type="password" value={secrets[f.key] ?? ""} onChange={(v) => setSecrets({ ...secrets, [f.key]: v })} autoComplete="new-password" />
      ))}
      {form.googleRedirect && <Callout><p>{t("In Google Cloud create an OAuth client (Web application), enable the API (Google Tasks API or Google Calendar API) and add this redirect URI:", "Google Cloud에서 OAuth 클라이언트(웹 애플리케이션)를 만들고 API(Google Tasks API 또는 Google Calendar API)를 켠 뒤 이 리디렉션 URI를 추가하세요:")}</p><code>{form.googleRedirect}</code></Callout>}
      <Actions><Button type="submit" busy={busy}>{t("Save and test", "저장하고 시험")}</Button></Actions>
    </form>
  );
}
