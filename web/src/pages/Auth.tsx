import { useState } from "react";
import { post } from "../api";
import { useT } from "../i18n";
import { Brand } from "../ui/brand";
import { Button, Copy, Input, useAction } from "../ui/kit";

const Frame = ({ children }: { children: React.ReactNode }) => (
  <div className="bg-muted/40 grid min-h-svh place-items-center px-4 py-8">
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center justify-center gap-2.5 text-lg font-bold"><Brand />memexhub</div>
      <div className="bg-card rounded-xl border p-6 shadow-sm">{children}</div>
    </div>
  </div>
);

export function Login({ onDone, error }: { onDone: () => void; error?: string }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [f, setF] = useState({ username: "", password: "", totp: "" });
  return (
    <Frame>
      <h1 style={{ marginBottom: "1rem" }}>{t("Sign in", "로그인")}</h1>
      {error === "two_factor_required" && <p className="callout warn">{t("From outside your home network you need two-factor sign-in.", "집 밖에서는 2단계 인증이 필요해요.")}</p>}
      <form onSubmit={(e) => { e.preventDefault(); void run(() => post("/login", f), undefined, onDone); }}>
        <Input label={t("Username", "아이디")} value={f.username} onChange={(v) => setF({ ...f, username: v })} autoComplete="username" required />
        <Input label={t("Password", "비밀번호")} type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="current-password" required />
        <Input label={t("Authenticator code", "인증 앱 코드")} hint={t("Only if two-factor is on.", "2단계 인증을 켠 경우에만 넣어요.")} value={f.totp} onChange={(v) => setF({ ...f, totp: v })} inputMode="numeric" autoComplete="one-time-code" />
        <Button type="submit" busy={busy}>{t("Sign in", "로그인")}</Button>
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
      <h1>{t("Welcome", "환영해요")}</h1>
      <p className="muted">{t("Create the admin account. You will use it here and when the Claude app asks you to sign in.", "관리자 계정을 만드세요. 이 화면과 Claude 앱 연결 때 이 계정으로 로그인해요.")}</p>
      <form onSubmit={(e) => { e.preventDefault(); void run(() => post("/setup", f), undefined, onDone); }}>
        <Input label={t("Setup code", "설정 코드")} hint={t("Printed once in the server log when memexhub started.", "memexhub가 처음 켜질 때 서버 로그에 한 번 나와요.")} value={f.code} onChange={(v) => setF({ ...f, code: v })} mono required />
        <Input label={t("Username", "아이디")} value={f.username} onChange={(v) => setF({ ...f, username: v })} autoComplete="username" required />
        <Input label={t("Password", "비밀번호")} hint={t("12 characters or more.", "12자 이상.")} type="password" value={f.password} onChange={(v) => setF({ ...f, password: v })} autoComplete="new-password" required />
        <Button type="submit" busy={busy}>{t("Create account", "계정 만들기")}</Button>
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
      <div>
        <p className="muted">{t("Use any authenticator app (1Password, Google Authenticator, Aegis …). It takes a minute.", "아무 인증 앱(1Password, Google Authenticator, Aegis 등)이나 쓰면 돼요. 1분이면 끝나요.")}</p>
        <Button busy={busy} onClick={() => run(() => post<{ secret: string; uri: string }>("/totp/start"), undefined, setKey)}>{t("Start", "시작")}</Button>
      </div>
    );
  return (
    <div>
      <ol className="steps">
        <li>{t("Add this key to your authenticator app (on a phone you can open the link).", "이 키를 인증 앱에 추가하세요(폰에서는 링크를 열어도 돼요).")}<Copy text={key.secret} /><a href={key.uri}>{t("Open in authenticator", "인증 앱에서 열기")}</a></li>
        <li>
          {t("Type the 6-digit code it shows.", "앱에 나온 6자리 코드를 넣으세요.")}
          <form className="row" style={{ marginTop: "0.4rem" }} onSubmit={(e) => { e.preventDefault(); void run(() => post("/totp/confirm", { code }), t("Two-factor is on.", "2단계 인증을 켰어요."), onDone); }}>
            <input style={{ maxWidth: "10rem" }} value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" aria-label={t("6-digit code", "6자리 코드")} />
            <Button type="submit" busy={busy}>{t("Turn on", "켜기")}</Button>
          </form>
        </li>
      </ol>
      <p className="hint">{t("Nothing changes until the code is right.", "코드가 맞기 전에는 아무것도 바뀌지 않아요.")}</p>
    </div>
  );
}

export function Enrol({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  return (
    <Frame>
      <h1>{t("Turn on two-factor first", "먼저 2단계 인증을 켜세요")}</h1>
      <p className="muted">{t("You are outside your home network. Before anything else, protect this page with an authenticator app.", "집 네트워크 밖에서 들어왔어요. 먼저 인증 앱으로 이 화면을 보호하세요.")}</p>
      <TwoFactorSetup onDone={onDone} />
    </Frame>
  );
}
