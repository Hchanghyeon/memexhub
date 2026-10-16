import { useState } from "react";
import { post } from "../api";
import { ago, useT } from "../i18n";
import { Badge, Button, Card, Dialog, Dot, Empty, Input, Loading, Page, Select, useAction, useData } from "../ui/kit";

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
      <Card>
        {data.items.length ? (
          <ul className="list">
            {data.items.map((x) => (
              <li key={x.id}>
                <Dot tone={!x.enabled ? "idle" : x.status === "ok" ? "ok" : x.status === "error" ? "err" : "idle"} />
                <div className="grow">
                  <span className="title">{x.name}</span> <Badge>{kind(x.kind)}</Badge> <Badge>{x.provider}</Badge>
                  <span className="meta">
                    {!x.enabled ? t("Off", "꺼짐") : x.status === "ok" ? t(`Working · checked ${ago(t, x.lastOkAt, "UTC")}`, `정상 · ${ago(t, x.lastOkAt, "UTC")} 확인`) : x.status === "error" ? <span className="err">{x.lastError}</span> : t("Not tested yet", "아직 시험 안 함")}
                    {x.email ? ` · ${x.email}` : ""}
                  </span>
                </div>
                <div className="row">
                  {x.provider === "google" && <Button size="sm" onClick={() => run(() => post<{ url: string }>(`/connections/${x.id}/google`), undefined, (r) => void (location.href = r.url))}>{x.email ? t("Sign in again", "다시 로그인") : t("Sign in with Google", "Google로 로그인")}</Button>}
                  {x.enabled && <Button kind="secondary" size="sm" busy={testing === x.id} onClick={async () => { setTesting(x.id); await run(() => post<{ ok: boolean; error?: string }>(`/connections/${x.id}/test`), (r) => (r.ok ? t("Working.", "정상이에요.") : t(`Failed: ${r.error}`, `실패: ${r.error}`)), reload); setTesting(null); }}>{t("Test", "시험")}</Button>}
                  <Button kind="secondary" size="sm" disabled={busy} onClick={() => run(() => post(`/connections/${x.id}/${x.enabled ? "disable" : "enable"}`), x.enabled ? t("Turned off.", "껐어요.") : t("Turned on.", "켰어요."), reload)}>{x.enabled ? t("Turn off", "끄기") : t("Turn on", "켜기")}</Button>
                </div>
              </li>
            ))}
          </ul>
        ) : <Empty>{t("Nothing connected yet.", "아직 연결한 것이 없어요.")}</Empty>}
      </Card>
      <Card title={t("Add a connection", "연결 추가")}>
        <div className="tiles" style={{ marginBottom: 0 }}>
          {data.addable.map((a) => (
            <button key={a.key} type="button" className="stat text-left" onClick={() => setAdding(a.key)}>
              <div className="text-muted-foreground text-xs font-medium">{kind(a.kind)}</div>
              <div className="mt-1 text-[0.95rem] font-semibold">{lang === "ko" ? a.title.ko : a.title.en}</div>
              <div className="text-muted-foreground mt-0.5 text-xs">{KIND[a.kind] ? t(KIND[a.kind]![2], KIND[a.kind]![3]) : ""}</div>
            </button>
          ))}
        </div>
      </Card>
      <Dialog open={!!adding} onClose={() => setAdding(null)} title={t("Add a connection", "연결 추가")}>
        {adding && <AddForm provider={adding} onDone={() => { setAdding(null); reload(); }} />}
      </Dialog>
    </Page>
  );
}

function AddForm({ provider, onDone }: { provider: string; onDone: () => void }) {
  const { t, lang } = useT();
  const { data: form } = useData<Form>(`/connections/form?provider=${encodeURIComponent(provider)}`);
  const { busy, run } = useAction();
  const [name, setName] = useState("");
  const [config, setConfig] = useState<Record<string, unknown>>({});
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  if (!form) return <Loading />;
  const val = (f: Field) => (config[f.key] ?? f.defaultValue ?? (f.type === "checkbox" ? false : "")) as string | boolean;
  return (
    <form onSubmit={(e) => {
      e.preventDefault();
      const cfg = Object.fromEntries(form.fields.map((f) => [f.key, f.type === "number" ? (val(f) === "" ? undefined : Number(val(f))) : val(f)]));
      void run(() => post<{ id: string; test: { ok: boolean; error?: string } }>("/connections", { provider, name, config: cfg, secrets }), (r) => (r.test.ok ? t("Connected and working.", "연결했고 정상이에요.") : t(`Saved, but the test failed: ${r.test.error}`, `저장했지만 시험에 실패했어요: ${r.test.error}`)), onDone);
    }}>
      <p className="muted">{lang === "ko" ? form.title.ko : form.title.en}</p>
      <Input label={t("Name", "이름")} hint={t("Your own label, e.g. personal or work.", "구분용 이름이에요. 예: personal, work")} value={name} onChange={setName} required />
      {form.fields.map((f) =>
        f.type === "checkbox" ? (
          <label key={f.key} className="check"><input type="checkbox" checked={!!val(f)} onChange={(e) => setConfig({ ...config, [f.key]: e.target.checked })} />{f.label}</label>
        ) : f.type === "select" ? (
          <Select key={f.key} label={f.label} value={String(val(f))} onChange={(v) => setConfig({ ...config, [f.key]: v })} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
        ) : (
          <Input key={f.key} label={`${f.label}${f.optional ? "" : " *"}`} value={String(val(f))} onChange={(v) => setConfig({ ...config, [f.key]: v })} inputMode={f.type === "number" ? "numeric" : undefined} required={!f.optional} />
        ),
      )}
      {form.secrets.map((f) => (
        <Input key={f.key} label={f.label} hint={t("Stored encrypted and never shown again.", "암호화해 저장하고 다시 보여주지 않아요.")} type="password" value={secrets[f.key] ?? ""} onChange={(v) => setSecrets({ ...secrets, [f.key]: v })} autoComplete="new-password" />
      ))}
      {form.googleRedirect && <p className="callout">{t("In Google Cloud create an OAuth client (Web application), enable the Google Tasks API and add this redirect URI:", "Google Cloud에서 OAuth 클라이언트(웹 애플리케이션)를 만들고 Google Tasks API를 켠 뒤 이 리디렉션 URI를 추가하세요:")} <code>{form.googleRedirect}</code></p>}
      <Button type="submit" busy={busy}>{t("Save and test", "저장하고 시험")}</Button>
    </form>
  );
}
