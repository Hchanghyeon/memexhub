import { useState } from "react";
import { post } from "../api";
import { useT } from "../i18n";
import { Brand } from "../ui/brand";
import { Actions, Button, Callout, Check, Copy, Hint, Input, Muted, Steps, useAction, QrCode } from "../ui/kit";
import { Input as UIInput } from "@/components/ui/input";

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-muted/40 grid min-h-svh place-items-center px-4 py-8">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex flex-col items-center justify-center gap-3 text-lg font-bold"><Brand size="lg" />memexhub</div>
      <div className="bg-card flex flex-col gap-5 rounded-xl border p-6 shadow-sm sm:p-8">{children}</div>
    </div>
  </div>
);

export function Login({ onDone, error, home }: { onDone: () => void; error?: string; home: boolean }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [f, setF] = useState({ username: "", password: "", totp: "", remember: true });
  return (
    <Frame>
      <h1 className="text-xl font-semibold tracking-tight">{t("Sign in", "로그인")}</h1>
      {error === "two_factor_required" && <Callout tone="warning"><p>{t("From outside your home network you need two-factor sign-in.", "집 밖에서는 2단계 인증이 필요해요.")}</p></Callout>}
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void run(() => post("/login", f), undefined, onDone); }}>
        <Input label={t("Username", "아이디")} value={f.username} onChange={(v) => setF({ ...f, username: v })} autoComplete="username" required />
        <Input label={t("Password", "비밀번호")} type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="current-password" required />
        {/* At home only the password is asked; from outside the authenticator code, unless this browser is remembered. */}
        {!home && <Input label={t("Authenticator code", "인증 앱 코드")} hint={t("Leave empty if this browser is remembered or two-factor is off.", "이 기기를 기억했거나 2단계 인증이 꺼져 있으면 비워 두세요.")} value={f.totp} onChange={(v) => setF({ ...f, totp: v })} inputMode="numeric" autoComplete="one-time-code" />}
        <Check checked={f.remember} onChange={(v) => setF({ ...f, remember: v })} label={t("Stay signed in for 30 days", "30일 동안 로그인 유지")}
          hint={home ? t("Off: signed out after 30 minutes without use. Not on a shared computer.", "끄면 30분 동안 안 쓰면 로그아웃돼요. 공용 컴퓨터에서는 끄세요.") : t("No password or code on this browser until then. Not on a shared computer.", "그동안 이 기기에서는 비밀번호도 코드도 다시 묻지 않아요. 공용 컴퓨터에서는 끄세요.")} />
        <Button type="submit" busy={busy} className="w-full">{t("Sign in", "로그인")}</Button>
      </form>
    </Frame>
  );
}

export function Setup({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [f, setF] = useState({ code: "", username: "", password: "" });
  return (
    <Frame>
      <div className="space-y-1.5"><h1 className="text-xl font-semibold tracking-tight">{t("Welcome", "환영해요")}</h1>
      <Muted>{t("Create the admin account. You will use it here and when the Claude app asks you to sign in.", "관리자 계정을 만드세요. 이 화면과 Claude 앱 연결 때 이 계정으로 로그인해요.")}</Muted></div>
      <form className="flex flex-col gap-5" onSubmit={(e) => { e.preventDefault(); void run(() => post("/setup", f), undefined, onDone); }}>
        <Input label={t("Setup code", "설정 코드")} hint={t("Printed once in the server log when memexhub started.", "memexhub가 처음 켜질 때 서버 로그에 한 번 나와요.")} value={f.code} onChange={(v) => setF({ ...f, code: v })} mono required />
        <Input label={t("Username", "아이디")} value={f.username} onChange={(v) => setF({ ...f, username: v })} autoComplete="username" required />
        <Input label={t("Password", "비밀번호")} hint={t("12 characters or more.", "12자 이상.")} type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" required />
        <Button type="submit" busy={busy} className="w-full">{t("Create account", "계정 만들기")}</Button>
      </form>
    </Frame>
  );
}

/** Two-factor enrolment: show the key, confirm a code. Used off-network right after setup and from Security. */
export function TwoFactorSetup({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [key, setKey] = useState<{ secret: string; uri: string }>();
  const [code, setCode] = useState("");
  if (!key)
    return (
      <div className="flex flex-col gap-4">
        <Muted>{t("Use any authenticator app (1Password, Google Authenticator, Aegis …). It takes a minute.", "아무 인증 앱(1Password, Google Authenticator, Aegis 등)이나 쓰면 돼요. 1분이면 끝나요.")}</Muted>
        <Actions><Button busy={busy} onClick={() => run(() => post<{ secret: string; uri: string }>("/totp/start"), undefined, setKey)}>{t("Start", "시작")}</Button></Actions>
      </div>
    );
  return (
    <div className="flex flex-col gap-4">
      <Steps>
        {[
          <div key="1" className="space-y-2"><p>{t("Scan this with your authenticator app: or copy the key, or on a phone open the link.", "인증 앱으로 이 QR을 찍으세요. 키를 복사하거나, 폰이라면 링크를 열어도 돼요.")}</p><QrCode text={key.uri} label={t("Two-factor QR code", "2단계 인증 QR 코드")} size={176} /><Copy text={key.secret} /><a href={key.uri} className="text-sm font-medium underline">{t("Open in authenticator", "인증 앱에서 열기")}</a></div>,
          <div key="2" className="space-y-2">
            <p>{t("Type the 6-digit code it shows.", "앱에 나온 6자리 코드를 넣으세요.")}</p>
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void run(() => post("/totp/confirm", { code }), t("Two-factor is on.", "2단계 인증을 켰어요."), onDone); }}>
              <UIInput className="max-w-40 font-mono tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label={t("6-digit code", "6자리 코드")} />
              <Button type="submit" busy={busy}>{t("Turn on", "켜기")}</Button>
            </form>
          </div>,
        ]}
      </Steps>
      <Hint>{t("Nothing changes until the code is right.", "코드가 맞기 전에는 아무것도 바뀌지 않아요.")}</Hint>
    </div>
  );
}

export function Enrol({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  return (
    <Frame>
      <div className="space-y-1.5">
        <h1 className="text-xl font-semibold tracking-tight">{t("Turn on two-factor first", "먼저 2단계 인증을 켜세요")}</h1>
        <Muted>{t("You are outside your home network. Before anything else, protect this page with an authenticator app.", "집 네트워크 밖에서 들어왔어요. 먼저 인증 앱으로 이 화면을 보호하세요.")}</Muted>
      </div>
      <TwoFactorSetup onDone={onDone} />
    </Frame>
  );
}
