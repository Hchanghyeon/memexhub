import { ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { useState } from "react";
import { post } from "../api";
import { useT } from "../i18n";
import { Link } from "../router";
import { Badge, Button, Card, Field, Fields, Hint, Input, Loading, More, Page, Segmented, Select, TextArea, Toggle, useAction, useData } from "../ui/kit";

interface F {
  modules: { id: string; enabled: boolean; error?: string }[];
  ledger: { officePlaces: string[]; paymentsNote: string; moneyNote: string; language: "en" | "ko"; inboxDays: number; mailSources: { connection: string; folder: string }[] };
  health: { note: string; language: "en" | "ko" };
  location: { connection: string; geocoder: string; privateAreas: string[]; language: "en" | "ko" };
  notion: { connection: string; ledger: boolean; health: boolean };
  choices: Record<"location" | "geocoder" | "notion", { name: string; provider: string }[]>;
}

const MOD: Record<string, [string, string, string, string]> = {
  vault: ["Vault", "볼트", "Read and write notes.", "노트 읽기·쓰기."],
  wiki: ["Wiki", "위키", "Keeps the wiki tidy: index, links, log.", "색인·링크·기록으로 위키를 정리해요."],
  hub: ["Summaries", "요약", "Day and week summaries, status.", "하루·한 주 요약과 상태."],
  ledger: ["Payments", "결제", "Card messages, Apple Pay and receipt mails become payment notes.", "카드 문자, Apple Pay, 영수증 메일을 결제 노트로 남겨요."],
  mail: ["Mail", "메일", "Claude reads your mailbox (read-only).", "Claude가 메일함을 읽어요 (읽기 전용)."],
  location: ["Location", "위치", "Where you were, place names for payments.", "다녀온 곳, 결제 장소 이름."],
  health: ["Health", "건강", "Sleep, steps and workouts become health notes.", "수면·걸음·운동을 건강 노트로 남겨요."],
  tasks: ["Tasks", "할 일", "Google Tasks for Claude.", "Claude가 Google Tasks를 써요."],
  notion: ["Notion", "Notion", "Copy records into Notion databases.", "기록을 Notion 데이터베이스로 복사해요."],
};
const BASIC = ["vault", "wiki", "hub"];

export function Features() {
  const { t } = useT();
  const { data, error, reload } = useData<F>("/features");
  const { busy, run } = useAction();
  if (!data) return <Page title={t("Features", "기능")}><Loading error={error} reload={reload} /></Page>;
  const on = (id: string) => !!data.modules.find((m) => m.id === id)?.enabled;
  const toggle = (id: string, v: boolean) => run(() => post("/modules", { on: data.modules.filter((m) => (m.id === id ? v : m.enabled)).map((m) => m.id) }), v ? t("Turned on.", "켰어요.") : t("Turned off.", "껐어요."), reload);
  return (
    <Page title={t("Features", "기능")} sub={t("Basic features are always on. Turn on the optional ones you need — their settings appear below.", "기본 기능은 항상 켜져 있어요. 필요한 선택 기능만 켜면 아래에 설정이 나와요.")}>
      <Card title={t("Features", "기능")}>
        {data.modules.map((m) => {
          const n = MOD[m.id] ?? [m.id, m.id, "", ""];
          const basic = BASIC.includes(m.id);
          return (
            <Toggle key={m.id} checked={m.enabled} disabled={basic || busy} onChange={(v) => void toggle(m.id, v)} label={t(n[0], n[1])} badge={<Badge tone={basic ? "basic" : "optional"}>{basic ? t("Basic", "기본") : t("Optional", "선택")}</Badge>}
              hint={<>{t(n[2], n[3])}{m.error && <span className="text-destructive"> — {m.error}</span>}</>} />
          );
        })}
      </Card>
      {on("ledger") && <Ledger f={data} reload={reload} />}
      {on("location") && <Location f={data} reload={reload} />}
      {on("health") && <Health f={data} reload={reload} />}
      {on("notion") && <Notion f={data} reload={reload} />}
    </Page>
  );
}

const NoteLang = ({ v, set }: { v: "en" | "ko"; set: (x: "en" | "ko") => void }) => {
  const { t } = useT();
  return <Field label={t("Language of notes", "노트 언어")}><Segmented value={v} onChange={set} options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }]} /></Field>;
};

function Ledger({ f, reload }: { f: F; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [s, setS] = useState({ ...f.ledger, officePlaces: f.ledger.officePlaces.join(", "), mailSources: f.ledger.mailSources.map((m) => `${m.connection}: ${m.folder}`).join("\n"), inboxDays: String(f.ledger.inboxDays) });
  const save = () => run(() => post("/ledger", {
    ...s, inboxDays: Number(s.inboxDays) || 30, officePlaces: s.officePlaces.split(","),
    mailSources: s.mailSources.split("\n").map((l) => /^\s*([^:]{1,32}?)\s*:\s*(.{1,200}?)\s*$/.exec(l)).filter(Boolean).map((m) => ({ connection: m![1]!, folder: m![2]! })),
  }), t("Payments saved.", "결제 설정을 저장했어요."), reload);
  return (
    <Card id="ledger" title={t("Payments", "결제")} aside={<Link to="/recipes" className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("Recipes & inbox", "레시피·대기함")} <ArrowRight /></Link>}
      footer={<Button busy={busy} onClick={() => void save()}>{t("Save", "저장")}</Button>}>
      <Fields>
        <Input label={t("Payments note", "결제 노트")} hint={t("{year} becomes the year.", "{year}는 연도로 바뀌어요.")} value={s.paymentsNote} onChange={(v) => setS({ ...s, paymentsNote: v })} mono />
        <Input label={t("Money summary note", "돈 요약 노트")} value={s.moneyNote} onChange={(v) => setS({ ...s, moneyNote: v })} mono />
      </Fields>
      <NoteLang v={s.language} set={(x) => setS({ ...s, language: x })} />
      <More summary={t("More", "더 보기")}>
        <Input label={t("Office places", "회사 장소")} hint={t("Place names from your location source, comma separated. Commutes there are tagged.", "위치 출처의 장소 이름, 쉼표로 구분. 그곳 출퇴근을 표시해요.")} value={s.officePlaces} onChange={(v) => setS({ ...s, officePlaces: v })} />
        <TextArea label={t("Receipt mail folders", "영수증 메일 폴더")} hint={t("One per line as connection: folder. Read every 15 minutes.", "한 줄에 하나씩 연결이름: 폴더. 15분마다 읽어요.")} value={s.mailSources} onChange={(v) => setS({ ...s, mailSources: v })} rows={3} placeholder="mail: Payments" mono />
        <Input label={t("Keep unreadable messages (days)", "못 읽은 메시지 보관 (일)")} value={s.inboxDays} onChange={(v) => setS({ ...s, inboxDays: v })} inputMode="numeric" narrow />
      </More>
    </Card>
  );
}

function Location({ f, reload }: { f: F; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [s, setS] = useState({ ...f.location, privateAreas: f.location.privateAreas.join(", ") });
  const opts = (k: "location" | "geocoder") => [{ value: "", label: t("First connected", "처음 연결된 것") }, ...f.choices[k].map((x) => ({ value: x.name, label: `${x.name} (${x.provider})` }))];
  return (
    <Card id="location" title={t("Location", "위치")}
      footer={<Button busy={busy} onClick={() => void run(() => post("/location", { ...s, privateAreas: s.privateAreas.split(",") }), t("Location saved.", "위치 설정을 저장했어요."), reload)}>{t("Save", "저장")}</Button>}>
      <Fields>
        <Select label={t("Location source", "위치 출처")} value={s.connection} onChange={(v) => setS({ ...s, connection: v })} options={opts("location")} />
        <Select label={t("Place names", "장소 이름")} value={s.geocoder} onChange={(v) => setS({ ...s, geocoder: v })} options={opts("geocoder")} />
      </Fields>
      <Input label={t("Private places", "비공개 장소")} hint={t("Never written anywhere. Comma separated.", "어디에도 쓰지 않아요. 쉼표로 구분.")} value={s.privateAreas} onChange={(v) => setS({ ...s, privateAreas: v })} />
      <NoteLang v={s.language} set={(x) => setS({ ...s, language: x })} />
      <Hint>{t("Phone: the OwnTracks app in HTTP mode → your address + /ingest/owntracks, a device token as the password (Devices).", "폰: OwnTracks 앱 HTTP 모드 → 내 주소 + /ingest/owntracks, 비밀번호는 기기 토큰 (기기 화면).")}</Hint>
    </Card>
  );
}

function Health({ f, reload }: { f: F; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [s, setS] = useState(f.health);
  return (
    <Card id="health" title={t("Health", "건강")} footer={<Button busy={busy} onClick={() => void run(() => post("/health", s), t("Health saved.", "건강 설정을 저장했어요."), reload)}>{t("Save", "저장")}</Button>}>
      <Input label={t("Health note", "건강 노트")} hint={t("{year} becomes the year.", "{year}는 연도로 바뀌어요.")} value={s.note} onChange={(v) => setS({ ...s, note: v })} mono />
      <NoteLang v={s.language} set={(x) => setS({ ...s, language: x })} />
    </Card>
  );
}

function Notion({ f, reload }: { f: F; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [s, setS] = useState(f.notion);
  return (
    <Card id="notion" title="Notion" sub={t("What you switch on is copied to Notion every 15 minutes. Re-syncing never duplicates rows.", "켠 것은 15분마다 Notion으로 복사돼요. 다시 동기화해도 중복되지 않아요.")}
      footer={<>
        <Button busy={busy} onClick={() => void run(() => post("/notion", s), t("Notion saved.", "Notion 설정을 저장했어요."), reload)}>{t("Save", "저장")}</Button>
        {(f.notion.ledger || f.notion.health) && <Button kind="secondary" busy={busy} onClick={() => void run(() => post<{ results: { kind: string; created: number; updated: number }[] }>("/notion/sync"), (r) => r.results.map((x) => `${x.kind}: +${x.created} / ~${x.updated}`).join(" · ") || t("Nothing to sync.", "동기화할 것이 없어요."))}>{t("Sync now", "지금 동기화")}</Button>}
      </>}>
      <Select label={t("Notion connection", "Notion 연결")} value={s.connection} onChange={(v) => setS({ ...s, connection: v })} options={[{ value: "", label: t("First connected", "처음 연결된 것") }, ...f.choices.notion.map((x) => ({ value: x.name, label: x.name }))]} />
      <div className="flex flex-col gap-5">
        <Toggle checked={s.ledger} onChange={(v) => setS({ ...s, ledger: v })} label={t("Copy payments", "결제 복사")} />
        <Toggle checked={s.health} onChange={(v) => setS({ ...s, health: v })} label={t("Copy health days", "건강 기록 복사")} />
      </div>
    </Card>
  );
}
