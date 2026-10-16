import { ArrowRight, CircleCheck, Circle, CircleDot } from "lucide-react";
import { useT, ago } from "../i18n";
import { Link } from "../router";
import { buttonVariants } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge, Card, Status, Item, List, Loading, Page, Tile, Tiles, useData } from "../ui/kit";
import { checkText, type Check } from "../checks";

interface O {
  timezone: string; now: string; onboarded: boolean;
  vault: { connected: boolean; preset: string | null };
  claude: { apps: number; used: boolean; last: string | null };
  payments: { last: string | null; inbox: number } | null;
  location: { last: string | null; source: string | null } | null;
  health: { last: string | null } | null;
  devices: { tokens: number; last: string | null };
  backup: { last: string | null } | null;
  mcpAnthropicOnly: boolean; totp: boolean;
  connectionErrors: { name: string; error: string | null }[];
  moduleErrors: { id: string; error: string }[];
  otherConnections: number;
  checks: Check[];
}

export function Overview() {
  const { t } = useT();
  const { data: o, error, reload } = useData<O>("/overview");
  if (!o) return <Page title={t("Overview", "개요")}><Loading error={error} reload={reload} /></Page>;
  const tz = o.timezone;
  const recent = (v: string | null, hours: number) => !!v && Date.now() - +new Date(v) < hours * 3600_000;
  const steps: { level: "required" | "recommended" | "optional"; done: boolean; title: [string, string]; how: [string, string]; to: string }[] = [
    { level: "required", done: o.vault.connected, title: ["Connect a vault", "볼트 연결"], how: ["Where your notes live. A folder on this server is enough.", "노트를 둘 곳이에요. 이 서버의 폴더면 충분해요."], to: "/vault" },
    { level: "required", done: o.claude.used, title: ["Add memexhub to the Claude app", "Claude 앱에 memexhub 추가"], how: ["Paste one address into the Claude app's connectors.", "Claude 앱의 커넥터에 주소 하나만 붙여 넣으면 돼요."], to: "/claude" },
    { level: "recommended", done: o.totp, title: ["Turn on two-factor sign-in", "2단계 인증 켜기"], how: ["Protects this page; needed to open it from outside.", "이 화면을 지켜요. 밖에서 열려면 꼭 필요해요."], to: "/security" },
    { level: "recommended", done: o.mcpAnthropicOnly, title: ["Let only Anthropic connect", "Anthropic만 접속 허용"], how: ["One switch. A leaked token then cannot be used elsewhere.", "스위치 하나예요. 토큰이 새도 다른 곳에서는 못 써요."], to: "/security" },
    ...(o.backup ? [{ level: "recommended" as const, done: recent(o.backup.last, 48), title: ["Daily backup", "매일 백업"] as [string, string], how: ["Made automatically. Download one now and then.", "자동으로 만들어요. 가끔 하나 내려받아 두세요."] as [string, string], to: "/backups" }] : []),
    { level: "optional", done: o.devices.tokens > 0, title: ["Send records from your phone", "폰에서 기록 보내기"], how: ["Card messages, Apple Pay, health, location.", "카드 문자, Apple Pay, 건강, 위치."], to: "/devices" },
    { level: "optional", done: o.otherConnections > 0, title: ["Connect mail, location or tasks", "메일·위치·할 일 연결"], how: ["Only what you want Claude to see.", "Claude가 볼 것만 연결하세요."], to: "/connections" },
  ];
  const core = steps.filter((s) => s.level !== "optional");
  const coreDone = core.filter((s) => s.done).length;
  const LEVEL = { required: t("Required", "필수"), recommended: t("Recommended", "추천"), optional: t("Optional", "선택") };
  const showSteps = coreDone < core.length;
  const attention = [
    ...o.connectionErrors.map((x) => ({ text: t(`Connection "${x.name}" failed: ${x.error ?? ""}`, `연결 "${x.name}" 오류: ${x.error ?? ""}`), to: "/connections", high: true })),
    ...o.moduleErrors.map((x) => ({ text: `${x.id}: ${x.error}`, to: "/features", high: true })),
    ...(o.payments?.inbox ? [{ text: t(`${o.payments.inbox} message(s) wait in the inbox.`, `읽지 못한 메시지 ${o.payments.inbox}개가 대기함에 있어요.`), to: "/recipes", high: false }] : []),
    ...o.checks.filter((c) => !c.ok && (!showSteps || c.level === "high")).map((c) => ({ text: checkText(t, c).text, to: checkText(t, c).fix ?? "/security", high: c.level === "high" })),
  ];
  const open = (to: string, label = t("Open", "열기")) => <Link to={to} className={buttonVariants({ variant: "outline", size: "sm" })}>{label}</Link>;
  return (
    <Page title={t("Overview", "개요")} sub={t(`Time zone ${tz}`, `시간대 ${tz}`)}>
      {showSteps && (
        <Card title={t("Getting started", "시작하기")} sub={t(`${coreDone} of ${core.length} essentials done`, `꼭 할 것 ${core.length}개 중 ${coreDone}개 완료`)}>
          <Progress value={(coreDone / core.length) * 100} className="h-1.5" />
          <List>
            {steps.map((s) => (
              <Item key={s.to + s.title[0]} done={s.done}
                icon={s.done ? <CircleCheck className="text-success" /> : s.level === "required" ? <CircleDot className="text-destructive" /> : <Circle className="text-muted-foreground/60" />}
                title={t(...s.title)} badges={<Badge tone={s.level}>{LEVEL[s.level]}</Badge>}
                meta={s.done ? undefined : t(...s.how)}
                actions={s.done ? undefined : open(s.to, t("Set up", "설정하기"))} />
            ))}
          </List>
        </Card>
      )}
      <Tiles>
        <Tile to="/vault" label={t("Vault", "볼트")} tone={o.vault.connected ? "ok" : "err"} value={o.vault.connected ? t("Connected", "연결됨") : t("Not connected", "연결 안 됨")} sub={o.vault.preset ?? undefined} />
        <Tile to="/claude" label="Claude" tone={o.claude.used ? "ok" : "idle"} value={o.claude.used ? ago(t, o.claude.last, tz) : t("Not connected", "연결 안 됨")} sub={t(`${o.claude.apps} app(s)`, `앱 ${o.claude.apps}개`)} />
        {o.payments && <Tile to="/recipes" label={t("Payments", "결제")} tone={o.payments.inbox ? "warn" : undefined} value={ago(t, o.payments.last, tz)} sub={o.payments.inbox ? t(`${o.payments.inbox} in the inbox`, `대기함 ${o.payments.inbox}개`) : t("Inbox empty", "대기함 비어 있음")} />}
        {o.location && <Tile to="/features" label={t("Location", "위치")} tone={recent(o.location.last, 6) ? "ok" : "err"} value={ago(t, o.location.last, tz)} sub={o.location.source ?? undefined} />}
        {o.health && <Tile to="/features" label={t("Health", "건강")} value={ago(t, o.health.last, tz)} />}
        <Tile to="/devices" label={t("Devices", "기기")} value={ago(t, o.devices.last, tz)} sub={t(`${o.devices.tokens} token(s)`, `토큰 ${o.devices.tokens}개`)} />
        {o.backup && <Tile to="/backups" label={t("Backup", "백업")} tone={recent(o.backup.last, 48) ? "ok" : "err"} value={ago(t, o.backup.last, tz)} />}
      </Tiles>
      <Card title={t("Needs attention", "확인할 것")}>
        {attention.length ? (
          <List>
            {attention.map((a, i) => (
              <Item key={i} tone={a.high ? "err" : "warn"} title={<span className="font-normal">{a.text}</span>}
                actions={<Link to={a.to} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("Open", "열기")}<ArrowRight /></Link>} />
            ))}
          </List>
        ) : <Status tone="ok">{t("All good.", "모두 괜찮아요.")}</Status>}
      </Card>
    </Page>
  );
}
