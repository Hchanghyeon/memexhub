import { useState } from "react";
import { useT, when } from "../i18n";
import { Badge, Card, Check, Empty, Item, List, Loading, Page, Segmented, Select, useData } from "../ui/kit";

interface A { rows: { at: string; kind: string; who: string | null; name: string | null; ip: string; ok: boolean; detail: string | null; where: string }[] }
interface Ch { rows: { at: string; actor: string; action: string; target: string | null; detail: string | null }[] }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Activity() {
  const { t } = useT();
  const [view, setView] = useState<"access" | "changes">("access");
  const [kind, setKind] = useState("");
  const [days, setDays] = useState("7");
  const [failed, setFailed] = useState(false);
  const q = view === "access" ? `/activity?view=access&kind=${kind}&days=${days}${failed ? "&failed=1" : ""}` : `/activity?view=changes&days=${days}`;
  const { data, error, reload } = useData<A & Ch>(q);
  const KIND: Record<string, string> = { admin: t("Admin sign-in", "관리자 로그인"), "claude.authorize": t("Claude connector sign-in", "Claude 커넥터 로그인"), "claude.token": t("Claude token", "Claude 토큰"), claude: t("Claude used tools", "Claude 도구 사용"), device: t("Device sent", "기기 수신"), dav: t("Vault sync", "볼트 동기화") };
  const WHERE: Record<string, string> = { home: t("home network", "집 네트워크"), anthropic: "Anthropic", internet: t("internet", "인터넷") };
  return (
    <Page title={t("Activity", "활동")}
      sub={view === "access" ? t("Who reached memexhub and from which address. Repeats are listed once an hour. Kept 90 days.", "누가 어느 주소에서 접속했는지예요. 반복 접속은 한 시간에 한 번만 남기고 90일 보관해요.") : t("Sign-ins, vault writes by Claude and devices, settings. Contents and secrets are never logged.", "로그인, Claude와 기기의 볼트 쓰기, 설정 변경. 내용과 비밀값은 남기지 않아요.")}>
      <Card>
        <Segmented value={view} onChange={setView} options={[{ value: "access", label: t("Who connected", "접속 기록") }, { value: "changes", label: t("What changed", "변경 기록") }]} />
        <div className="grid items-end gap-4 sm:grid-cols-[12rem_9rem_1fr]">
          {view === "access" && <Select label={t("Kind", "종류")} value={kind} onChange={setKind} options={[{ value: "", label: t("Everything", "전체") }, { value: "admin", label: KIND.admin! }, { value: "claude", label: "Claude" }, { value: "device", label: t("Devices", "기기") }, { value: "dav", label: KIND.dav! }]} />}
          <Select label={t("Period", "기간")} value={days} onChange={setDays} options={[["1", t("1 day", "1일")], ["7", t("7 days", "7일")], ["30", t("30 days", "30일")], ["90", t("90 days", "90일")]].map(([v, l]) => ({ value: v!, label: l! }))} />
          {view === "access" && <div className="pb-2"><Check checked={failed} onChange={setFailed} label={t("Refused only", "거부만")} /></div>}
        </div>
      </Card>
      {!data ? <Loading error={error} reload={reload} /> : (
        <Card>
          {!data.rows.length ? <Empty>{t("Nothing in this period.", "이 기간에는 없어요.")}</Empty> : view === "access" ? (
            <List>
              {(data as A).rows.map((r, i) => (
                <Item key={i} tone={r.ok ? "ok" : "err"} title={<>{KIND[r.kind] ?? r.kind}{r.name && <span className="text-muted-foreground font-normal">{r.name}</span>}</>}
                  badges={!r.ok && <Badge tone="required">{t("refused", "거부")}</Badge>}
                  meta={<>{when(r.at, tz)} · <code>{r.ip}</code> {WHERE[r.where]}{r.detail ? ` · ${r.detail}` : ""}</>} />
              ))}
            </List>
          ) : (
            <List>
              {(data as Ch).rows.map((r, i) => (
                <Item key={i} tone="idle" title={<>{r.action}{r.target && <code className="font-normal">{r.target}</code>}</>}
                  meta={`${when(r.at, tz)} · ${r.actor.length > 28 ? `${r.actor.slice(0, 28)}…` : r.actor}${r.detail ? ` · ${r.detail.slice(0, 90)}` : ""}`} />
              ))}
            </List>
          )}
        </Card>
      )}
    </Page>
  );
}
