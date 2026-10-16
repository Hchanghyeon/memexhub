import { useT, ago } from "../i18n";
import { Link } from "../router";
import { Badge, Card, Dot, Loading, Page, useData } from "../ui/kit";
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
  const Stat = (p: { to: string; k: string; v: string; s?: string; tone?: "ok" | "err" }) => (
    <Link to={p.to} className="card stat">
      <div className="k">{p.k}</div>
      <div className="v">{p.tone && <Dot tone={p.tone} />}{p.v}</div>
      {p.s && <div className="s">{p.s}</div>}
    </Link>
  );
  return (
    <Page title={t("Overview", "개요")}>
      {showSteps && (
        <Card title={t("Getting started", "시작하기")} sub={t(`${coreDone} of ${core.length} essentials done`, `꼭 할 것 ${core.length}개 중 ${coreDone}개 완료`)}>
          <div className="progress"><span style={{ width: `${(coreDone / core.length) * 100}%` }} /></div>
          <ul className="list checklist">
            {steps.map((s) => (
              <li key={s.to + s.title[0]} className={s.done ? "done" : ""}>
                <Dot tone={s.done ? "ok" : s.level === "required" ? "err" : "idle"} />
                <div className="grow">
                  <span className="title">{t(...s.title)}</span> <Badge tone={s.level}>{LEVEL[s.level]}</Badge>
                  {!s.done && <span className="meta">{t(...s.how)}</span>}
                </div>
                {!s.done && <Link to={s.to} className="btn secondary sm">{t("Set up", "설정하기")}</Link>}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="grid">
        <Stat to="/vault" k={t("Vault", "볼트")} tone={o.vault.connected ? "ok" : "err"} v={o.vault.connected ? t("Connected", "연결됨") : t("Not connected", "연결 안 됨")} s={o.vault.preset ?? undefined} />
        <Stat to="/claude" k="Claude" tone={o.claude.used ? "ok" : undefined} v={o.claude.used ? ago(t, o.claude.last, tz) : t("Not connected", "연결 안 됨")} s={t(`${o.claude.apps} app(s)`, `앱 ${o.claude.apps}개`)} />
        {o.payments && <Stat to="/recipes" k={t("Payments", "결제")} v={ago(t, o.payments.last, tz)} s={o.payments.inbox ? t(`${o.payments.inbox} in the inbox`, `대기함 ${o.payments.inbox}개`) : t("Inbox empty", "대기함 비어 있음")} tone={o.payments.inbox ? "err" : undefined} />}
        {o.location && <Stat to="/features" k={t("Location", "위치")} tone={recent(o.location.last, 6) ? "ok" : "err"} v={ago(t, o.location.last, tz)} s={o.location.source ?? undefined} />}
        {o.health && <Stat to="/features" k={t("Health", "건강")} v={ago(t, o.health.last, tz)} />}
        <Stat to="/devices" k={t("Devices", "기기")} v={ago(t, o.devices.last, tz)} s={t(`${o.devices.tokens} token(s)`, `토큰 ${o.devices.tokens}개`)} />
        {o.backup && <Stat to="/backups" k={t("Backup", "백업")} tone={recent(o.backup.last, 48) ? "ok" : "err"} v={ago(t, o.backup.last, tz)} />}
      </div>
      <Card title={t("Needs attention", "확인할 것")}>
        {attention.length ? (
          <ul className="list">
            {attention.map((a, i) => (
              <li key={i}><Dot tone={a.high ? "err" : "warn"} /><span className="grow">{a.text}</span><Link to={a.to} className="btn ghost sm">{t("Open", "열기")} →</Link></li>
            ))}
          </ul>
        ) : <p className="ok" style={{ margin: 0 }}>✓ {t("All good.", "모두 괜찮아요.")}</p>}
      </Card>
      <p className="muted">{t("Time zone", "시간대")} {tz}</p>
    </Page>
  );
}
