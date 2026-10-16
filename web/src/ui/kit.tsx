import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ApiError, get } from "../api";
import { useT, type T } from "../i18n";

// ---------- data ----------
/** Load an API path; reload() after a change. */
export function useData<D>(path: string | null) {
  const [data, setData] = useState<D>();
  const [error, setError] = useState<ApiError>();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!path) return;
    let live = true;
    get<D>(path).then((d) => live && (setData(d), setError(undefined)), (e) => live && setError(e));
    return () => void (live = false);
  }, [path, tick]);
  return { data, error, reload: useCallback(() => setTick((n) => n + 1), []) };
}

/** Plain words for API error codes. */
export function errorText(t: T, e: unknown): string {
  if (!(e instanceof ApiError)) return t("Something went wrong. Try again.", "문제가 생겼어요. 다시 해 보세요.");
  const d = e.detail ? ` (${e.detail})` : "";
  const m: Record<string, [string, string]> = {
    login_failed: ["Wrong username, password or code.", "아이디, 비밀번호 또는 코드가 맞지 않아요."],
    two_factor_required: ["From outside your home network you need two-factor sign-in. Turn it on from home first.", "집 밖에서는 2단계 인증이 필요해요. 먼저 집에서 켜세요."],
    wrong_setup_code: ["Wrong setup code. Copy it from the server log.", "설정 코드가 맞지 않아요. 서버 로그에서 복사하세요."],
    wrong_code: ["That code did not match. Check the time on your phone and try the newest code.", "코드가 맞지 않아요. 폰 시간을 확인하고 가장 새 코드를 넣어 보세요."],
    two_factor_first: ["Turn on two-factor first.", "먼저 2단계 인증을 켜세요."],
    vault_unavailable: ["Saved, but the vault could not be opened — check the path or account.", "저장했지만 볼트를 열 수 없어요. 경로나 계정을 확인하세요."],
    vault_test_failed: [`Could not open the vault${d}.`, `볼트를 열 수 없어요${d}.`],
    invalid_settings: [`Some fields are not valid${d}.`, `올바르지 않은 칸이 있어요${d}.`],
    invalid_input: [`Some fields are not valid${d}.`, `올바르지 않은 칸이 있어요${d}.`],
    invalid_layout: ["That layout is not valid. Check the folder names.", "구조가 올바르지 않아요. 폴더 이름을 확인하세요."],
    choose_file: ["Choose a file first.", "먼저 파일을 고르세요."],
    type_restore: ["Type RESTORE to confirm.", "확인하려면 RESTORE를 입력하세요."],
    token_known: ["That token is already known.", "이미 있는 토큰이에요."],
    ledger_off: ["Turn on the Payments feature first.", "먼저 결제 기능을 켜세요."],
    bad_csrf: ["The page is out of date. Reload it.", "화면이 오래됐어요. 새로고침하세요."],
    signed_out: ["You were signed out.", "로그아웃됐어요."],
  };
  const x = m[e.code];
  return x ? t(...x) : e.detail ? e.detail : t(`Failed: ${e.code}`, `실패: ${e.code}`);
}

// ---------- toasts ----------
type Toast = { id: number; kind: "ok" | "err"; text: string };
const ToastCtx = createContext<(kind: "ok" | "err", text: string) => void>(() => {});
export function Toasts({ children }: { children: ReactNode }) {
  const [list, setList] = useState<Toast[]>([]);
  const push = useCallback((kind: "ok" | "err", text: string) => {
    const id = Date.now() + Math.random();
    setList((l) => [...l.slice(-2), { id, kind, text }]);
    setTimeout(() => setList((l) => l.filter((x) => x.id !== id)), kind === "err" ? 7000 : 3200);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {list.map((x) => (
          <div key={x.id} className={`toast ${x.kind}`} onClick={() => setList((l) => l.filter((y) => y.id !== x.id))}>
            <span className="toast-icon">{x.kind === "ok" ? "✓" : "!"}</span>
            {x.text}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
export const useToast = () => useContext(ToastCtx);

/** Run a change: busy state, a toast with the result, then onDone. */
export function useAction() {
  const toast = useToast();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <R,>(fn: () => Promise<R>, ok?: string | ((r: R) => string), onDone?: (r: R) => void) => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) toast("ok", typeof ok === "function" ? ok(r) : ok);
        onDone?.(r);
        return r;
      } catch (e) {
        toast("err", errorText(t, e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [toast, t],
  );
  return { busy, run };
}

// ---------- layout pieces ----------
export const Page = (p: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) => (
  <div className="page">
    <header className="page-head">
      <div>
        <h1>{p.title}</h1>
        {p.sub && <p className="muted">{p.sub}</p>}
      </div>
      {p.actions && <div className="row">{p.actions}</div>}
    </header>
    {p.children}
  </div>
);

export const Card = (p: { title?: ReactNode; badge?: ReactNode; sub?: ReactNode; id?: string; children?: ReactNode; className?: string; aside?: ReactNode }) => (
  <section className={`card ${p.className ?? ""}`} id={p.id}>
    {(p.title || p.aside) && (
      <div className="card-head">
        <div>
          {p.title && <h2>{p.title} {p.badge}</h2>}
          {p.sub && <p className="muted">{p.sub}</p>}
        </div>
        {p.aside}
      </div>
    )}
    {p.children}
  </section>
);

export const Badge = (p: { tone?: "required" | "recommended" | "optional" | "basic" | "neutral"; children: ReactNode }) => <span className={`badge ${p.tone ?? "neutral"}`}>{p.children}</span>;
export const Dot = (p: { tone: "ok" | "err" | "idle" | "warn" }) => <span className={`dot ${p.tone}`} aria-hidden />;
export const Skeleton = (p: { lines?: number }) => (
  <div className="skeleton" aria-busy>
    {Array.from({ length: p.lines ?? 3 }, (_, i) => <span key={i} style={{ width: `${90 - i * 15}%` }} />)}
  </div>
);
export function Loading({ error, reload }: { error?: unknown; reload?: () => void }) {
  const { t } = useT();
  if (!error) return <Card><Skeleton lines={4} /></Card>;
  return (
    <Card>
      <p className="err">{errorText(t, error)}</p>
      {reload && <Button kind="secondary" onClick={reload}>{t("Try again", "다시 시도")}</Button>}
    </Card>
  );
}

// ---------- controls ----------
export function Button(p: { kind?: "primary" | "secondary" | "danger" | "ghost"; size?: "sm"; busy?: boolean; disabled?: boolean; type?: "button" | "submit"; onClick?: () => void; children: ReactNode; title?: string }) {
  return (
    <button type={p.type ?? "button"} className={`btn ${p.kind ?? "primary"} ${p.size ?? ""}`} disabled={p.disabled || p.busy} onClick={p.onClick} title={p.title} aria-busy={p.busy}>
      {p.busy && <span className="spinner" aria-hidden />}
      {p.children}
    </button>
  );
}

export function Field(p: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{p.label}</label>
      {p.children(id)}
      {p.hint && <p className="hint">{p.hint}</p>}
    </div>
  );
}
export const Input = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string; inputMode?: "numeric" | "text"; required?: boolean; mono?: boolean }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => <input id={id} className={p.mono ? "mono" : undefined} type={p.type ?? "text"} value={p.value} placeholder={p.placeholder} autoComplete={p.autoComplete} inputMode={p.inputMode} required={p.required} onChange={(e) => p.onChange(e.target.value)} />}
  </Field>
);
export const TextArea = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => <textarea id={id} className={p.mono ? "mono" : undefined} rows={p.rows ?? 4} value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />}
  </Field>
);
export const Select = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => (
      <select id={id} value={p.value} onChange={(e) => p.onChange(e.target.value)}>
        {p.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    )}
  </Field>
);
/** On/off switch with a title and a one-line explanation. */
export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; badge?: ReactNode }) {
  const id = useId();
  return (
    <div className={`toggle ${p.disabled ? "disabled" : ""}`}>
      <div className="toggle-text">
        <label htmlFor={id}>{p.label} {p.badge}</label>
        {p.hint && <p className="hint">{p.hint}</p>}
      </div>
      <button id={id} type="button" role="switch" aria-checked={p.checked} className="switch" disabled={p.disabled} onClick={() => p.onChange(!p.checked)}>
        <span />
      </button>
    </div>
  );
}
export function Segmented<V extends string>(p: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; label?: string }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={p.label}>
      {p.options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={p.value === o.value} onClick={() => p.onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

export function Copy({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="copy">
      <code>{text}</code>
      <Button kind="secondary" size="sm" onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          const r = document.createRange();
          r.selectNodeContents(document.activeElement?.parentElement?.querySelector("code") ?? document.body);
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}>{done ? t("Copied", "복사됨") : label ?? t("Copy", "복사")}</Button>
    </div>
  );
}

/** A modal dialog (native <dialog>). */
export function Dialog(p: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (p.open && !d.open) d.showModal();
    if (!p.open && d.open) d.close();
  }, [p.open]);
  return (
    <dialog ref={ref} className="dialog" onClose={p.onClose} onClick={(e) => e.target === ref.current && p.onClose()}>
      <div className="dialog-body">
        <div className="card-head">
          <h2>{p.title}</h2>
          <button type="button" className="icon-btn" aria-label="Close" onClick={p.onClose}>✕</button>
        </div>
        {p.open && p.children}
      </div>
    </dialog>
  );
}

/** Confirm before something that cannot be undone. */
export function useConfirm() {
  const { t } = useT();
  return (text: string) => window.confirm(text || t("Are you sure?", "정말 할까요?"));
}

export const Empty = (p: { children: ReactNode }) => <p className="empty">{p.children}</p>;
