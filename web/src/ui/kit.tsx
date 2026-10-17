import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check as CheckIcon, ChevronRight, CircleAlert, Copy as CopyIcon, Info, Loader2, TriangleAlert } from "lucide-react";
import { ApiError, get } from "../api";
import { explain } from "../explain";
import { useT, type T } from "../i18n";
import { cn } from "@/lib/utils";
import { encode as qrEncode } from "uqr";
import { Button as UIButton } from "@/components/ui/button";
import { Badge as UIBadge } from "@/components/ui/badge";
import { Input as UIInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton as UISkeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Link } from "../router";
import { Select as UISelect, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Dialog as UIDialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Toaster } from "@/components/ui/sonner";

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
    wrong_password: ["The current password is not right.", "지금 비밀번호가 맞지 않아요."],
    two_factor_required: ["From outside your home network you need two-factor sign-in. Turn it on from home first.", "집 밖에서는 2단계 인증이 필요해요. 먼저 집에서 켜세요."],
    wrong_setup_code: ["Wrong setup code. Copy it from the server log.", "설정 코드가 맞지 않아요. 서버 로그에서 복사하세요."],
    wrong_code: ["That code did not match. Check the time on your phone and try the newest code.", "코드가 맞지 않아요. 폰 시간을 확인하고 가장 새 코드를 넣어 보세요."],
    two_factor_first: ["Turn on two-factor first.", "먼저 2단계 인증을 켜세요."],
    vault_unavailable: ["Saved, but the vault could not be opened: check the path or account.", "저장했지만 볼트를 열 수 없어요. 경로나 계정을 확인하세요."],
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
    already_on: ["It is already on.", "이미 켜져 있어요."],
    already_set_up: ["This server is already set up. Sign in instead.", "이미 설정된 서버예요. 로그인하세요."],
    google_failed: [`Sign-in could not start${d}.`, `로그인을 시작하지 못했어요${d}.`],
    import_failed: [`Could not import${d}.`, `가져오지 못했어요${d}.`],
    invalid_json: ["That is not valid JSON.", "올바른 JSON이 아니에요."],
    module_off: ["Turn on that feature first (Features).", "먼저 기능 화면에서 그 기능을 켜세요."],
    not_found: ["It is no longer there. Reload the page.", "이제 없어요. 화면을 새로고침하세요."],
    not_pending: ["This message was already handled.", "이미 처리한 메시지예요."],
    recipe_failed: [`The recipe could not be used${d}.`, `레시피를 쓸 수 없어요${d}.`],
    resolve_failed: [`Could not record it${d}.`, `기록하지 못했어요${d}.`],
    restore_failed: [`Could not restore${d}.`, `되돌리지 못했어요${d}.`],
    sync_failed: [`Sync failed${d}.`, `동기화하지 못했어요${d}.`],
    unknown_connection: ["That connection no longer exists. Reload the page.", "그 연결이 없어요. 화면을 새로고침하세요."],
    unknown_preset: ["Unknown layout.", "모르는 구조예요."],
    unknown_provider: ["Unknown service.", "모르는 서비스예요."],
    enrol_first: ["Set up the authenticator app first.", "먼저 인증 앱을 등록하세요."],
    forbidden: ["Not allowed from here.", "여기서는 할 수 없어요."],
    origin_not_allowed: ["Open the admin page from its own address.", "관리 화면 주소로 직접 열어 주세요."],
    rate_limited: ["Too many tries. Wait a minute and try again.", "너무 많이 시도했어요. 1분 뒤에 다시 해 보세요."],
    too_large: ["That is too large.", "너무 커요."],
    setup_required: ["Finish the first setup first.", "먼저 처음 설정을 마치세요."],
    unauthorized: ["Sign in again.", "다시 로그인하세요."],
    internal: ["Something went wrong on the server. Try again.", "서버에서 문제가 생겼어요. 다시 해 보세요."],
    server_error: ["Something went wrong on the server. Try again.", "서버에서 문제가 생겼어요. 다시 해 보세요."],
  };
  const x = m[e.code];
  return x ? t(...x) : e.detail ? explain(t, e.detail) : t(`Failed: ${e.code}`, `실패: ${e.code}`);
}

// ---------- toasts ----------
export function Toasts({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toaster />
    </>
  );
}
export const useToast = () => useCallback((kind: "ok" | "err", text: string) => (kind === "ok" ? toast.success(text) : toast.error(text, { duration: 7000 })), []);

/** Run a change: busy state, a toast with the result, then onDone. */
export function useAction() {
  const push = useToast();
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const run = useCallback(
    async <R,>(fn: () => Promise<R>, ok?: string | ((r: R) => string), onDone?: (r: R) => void) => {
      setBusy(true);
      try {
        const r = await fn();
        if (ok) push("ok", typeof ok === "function" ? ok(r) : ok);
        onDone?.(r);
        return r;
      } catch (e) {
        push("err", errorText(t, e));
        return undefined;
      } finally {
        setBusy(false);
      }
    },
    [push, t],
  );
  return { busy, run };
}

// ---------- layout ----------
// Spacing scale (docs/design.md → Design system): 8 inside a control group, 16 between
// fields and rows, 24 between sections and as section padding, 32 under the page header.

/** One screen: title, one-line description, optional actions, then sections 24 px apart. */
export const Page = (p: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) => (
  <div className="mx-auto w-full max-w-3xl px-4 pt-6 pb-24 sm:px-8 md:pt-12">
    <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{p.title}</h1>
        {p.sub && <p className="text-muted-foreground max-w-prose">{p.sub}</p>}
      </div>
      {p.actions && <div className="flex flex-wrap items-center gap-2">{p.actions}</div>}
    </header>
    <div className="flex flex-col gap-6">{p.children}</div>
  </div>
);

/**
 * A titled block of the page. Its body stacks children 20 px apart.
 * `footer` holds the save button (left-aligned, on a tinted strip); pass `onSubmit` to make it a form.
 */
export function Card(p: { title?: ReactNode; badge?: ReactNode; sub?: ReactNode; aside?: ReactNode; footer?: ReactNode; id?: string; className?: string; onSubmit?: () => void; children?: ReactNode }) {
  const body = (
    <>
      {(p.title || p.aside) && (
        <div className="flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6">
          <div className="min-w-0 space-y-1">
            {p.title && <h2 className="flex flex-wrap items-center gap-2 text-base leading-6 font-semibold">{p.title}{p.badge}</h2>}
            {p.sub && <p className="text-muted-foreground">{p.sub}</p>}
          </div>
          {p.aside && <div className="-my-1 flex shrink-0 items-center gap-2">{p.aside}</div>}
        </div>
      )}
      {p.children !== undefined && p.children !== null && p.children !== false && <div className="flex flex-col gap-5 p-5 sm:p-6">{p.children}</div>}
      {p.footer && <div className="bg-muted/40 flex flex-wrap items-center gap-2 rounded-b-xl border-t px-5 py-3 sm:px-6">{p.footer}</div>}
    </>
  );
  const cls = cn("bg-card text-card-foreground scroll-mt-6 rounded-xl border", p.className);
  return p.onSubmit ? (
    <form id={p.id} className={cls} onSubmit={(e) => { e.preventDefault(); p.onSubmit!(); }}>{body}</form>
  ) : (
    <section id={p.id} className={cls}>{body}</section>
  );
}

/** A small heading inside a card, for groups of rows. */
export const Sub = (p: { children: ReactNode }) => <h3 className="text-muted-foreground -mb-2 text-[0.8125rem] font-medium">{p.children}</h3>;

/** A row of buttons. */
export const Actions = (p: { children: ReactNode }) => <div className="flex flex-wrap items-center gap-2">{p.children}</div>;

/** Two fields side by side on wider screens. */
export const Fields = (p: { children: ReactNode }) => <div className="grid gap-5 sm:grid-cols-2">{p.children}</div>;

// ---------- lists ----------
/** Rows separated by hairlines. Put it straight inside a Card. */
export const List = (p: { children: ReactNode }) => <ul className="-my-3 divide-y">{p.children}</ul>;

/** One row: status dot, title with badges, a muted meta line, actions on the right, optional details below. */
export function Item(p: { tone?: keyof typeof DOT; icon?: ReactNode; title: ReactNode; badges?: ReactNode; meta?: ReactNode; actions?: ReactNode; children?: ReactNode; done?: boolean }) {
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {p.icon ? <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center [&_svg]:size-[18px]">{p.icon}</span> : p.tone && <span className={cn("mt-2 size-2 shrink-0 rounded-full", DOT[p.tone])} aria-hidden />}
        {/* On a phone the actions go under the text so the title keeps the full width. */}
        <div className="flex min-w-0 flex-1 flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <div className={cn("flex flex-wrap items-center gap-x-2 gap-y-1 font-medium", p.done && "text-muted-foreground line-through")}>{p.title}{p.badges}</div>
            {p.meta && <div className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-5">{p.meta}</div>}
          </div>
          {p.actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{p.actions}</div>}
        </div>
      </div>
      {p.children && <div className="mt-4 flex flex-col gap-4 sm:pl-5">{p.children}</div>}
    </li>
  );
}

/** Tiles that link somewhere (overview numbers, things to add). */
export const Tiles = (p: { children: ReactNode }) => <div className="grid grid-cols-2 gap-3 md:grid-cols-3">{p.children}</div>;
export function Tile(p: { to?: string; onClick?: () => void; label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: keyof typeof DOT }) {
  const inner = (
    <>
      <div className="text-muted-foreground text-[0.8125rem]">{p.label}</div>
      <div className="mt-1 flex items-center gap-2 text-[0.9375rem] font-semibold">{p.tone && <span className={cn("size-2 shrink-0 rounded-full", DOT[p.tone])} aria-hidden />}{p.value}</div>
      {p.sub && <div className="text-muted-foreground mt-0.5 text-[0.8125rem] leading-5">{p.sub}</div>}
    </>
  );
  const cls = "bg-card hover:bg-accent/60 block min-w-0 rounded-xl border p-4 text-left text-foreground no-underline transition-colors cursor-pointer";
  return p.to ? <Link to={p.to} className={cls}>{inner}</Link> : <button type="button" className={cls} onClick={p.onClick}>{inner}</button>;
}

// ---------- small pieces ----------
const BADGE = { required: "destructive", recommended: "info", optional: "outline", basic: "secondary", neutral: "outline" } as const;
export const Badge = (p: { tone?: keyof typeof BADGE; children: ReactNode }) => <UIBadge variant={BADGE[p.tone ?? "neutral"]}>{p.children}</UIBadge>;

const DOT = { ok: "bg-success", err: "bg-destructive", warn: "bg-warning", idle: "bg-muted-foreground/35" };
/** Coloured text with a dot: "● Connected". */
export const Status = (p: { tone: keyof typeof DOT; children: ReactNode }) => (
  <span className="inline-flex items-center gap-2 font-medium"><span className={cn("size-2 shrink-0 rounded-full", DOT[p.tone])} aria-hidden />{p.children}</span>
);

const CALLOUT = {
  info: ["bg-muted/60 border-transparent", Info],
  warning: ["border-warning/40 bg-warning/10", TriangleAlert],
  error: ["border-destructive/40 bg-destructive/5 text-destructive", CircleAlert],
} as const;
export function Callout(p: { tone?: keyof typeof CALLOUT; children: ReactNode }) {
  const [cls, Icon] = CALLOUT[p.tone ?? "info"];
  return (
    <div role={p.tone === "error" ? "alert" : undefined} className={cn("flex gap-3 rounded-lg border px-4 py-3", cls)}>
      <Icon className="mt-1 size-4 shrink-0 opacity-70" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">{p.children}</div>
    </div>
  );
}

/** Numbered how-to steps. */
export const Steps = (p: { children: ReactNode[] }) => (
  <ol className="flex flex-col gap-4">
    {p.children.filter(Boolean).map((c, i) => (
      <li key={i} className="flex gap-3">
        <span className="bg-primary text-primary-foreground mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[0.6875rem] font-semibold">{i + 1}</span>
        <div className="min-w-0 flex-1 space-y-2">{c}</div>
      </li>
    ))}
  </ol>
);

/** Label → value pairs. */
export const KeyValue = (p: { rows: [ReactNode, ReactNode][] }) => (
  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-[minmax(0,11rem)_1fr] sm:gap-y-3">
    {p.rows.map(([k, v], i) => (
      <div key={i} className="contents">
        <dt className="text-muted-foreground pt-2 sm:pt-0">{k}</dt>
        <dd className="min-w-0 break-all">{v}</dd>
      </div>
    ))}
  </dl>
);

/** Hidden-by-default extra settings. */
export const More = (p: { summary: ReactNode; children: ReactNode; open?: boolean }) => (
  <details className="group" open={p.open}>
    <summary className="text-muted-foreground hover:text-foreground flex w-fit cursor-pointer list-none items-center gap-1 font-medium select-none [&::-webkit-details-marker]:hidden">
      <ChevronRight className="size-4 transition-transform group-open:rotate-90" aria-hidden />{p.summary}
    </summary>
    <div className="mt-4 flex flex-col gap-5 border-l pl-5">{p.children}</div>
  </details>
);

export const Tags = (p: { children: ReactNode }) => <div className="flex flex-wrap gap-1.5">{p.children}</div>;
export const Hint = (p: { children: ReactNode }) => <p className="text-muted-foreground text-[0.8125rem] leading-5">{p.children}</p>;
export const Muted = (p: { children: ReactNode }) => <p className="text-muted-foreground">{p.children}</p>;

/** Kept for older call sites: a status dot before text. */
export const Dot = (p: { tone: keyof typeof DOT }) => <span className={cn("mr-2 inline-block size-2 shrink-0 rounded-full align-middle", DOT[p.tone])} aria-hidden />;

export const Skeleton = (p: { lines?: number }) => (
  <div className="space-y-3" aria-busy>
    {Array.from({ length: p.lines ?? 3 }, (_, i) => <UISkeleton key={i} className="h-4" style={{ width: `${90 - i * 15}%` }} />)}
  </div>
);
export function Loading({ error, reload }: { error?: unknown; reload?: () => void }) {
  const { t } = useT();
  if (!error) return <Card><Skeleton lines={4} /></Card>;
  return (
    <Card>
      <Callout tone="error">{errorText(t, error)}</Callout>
      {reload && <Actions><Button kind="secondary" onClick={reload}>{t("Try again", "다시 시도")}</Button></Actions>}
    </Card>
  );
}
export const Empty = (p: { children: ReactNode }) => <p className="text-muted-foreground py-4 text-center">{p.children}</p>;

// ---------- controls ----------
const KIND = { primary: "default", secondary: "outline", danger: "destructive", ghost: "ghost" } as const;
export function Button(p: { kind?: keyof typeof KIND; size?: "sm"; busy?: boolean; disabled?: boolean; type?: "button" | "submit"; onClick?: () => void; children: ReactNode; title?: string; className?: string }) {
  return (
    <UIButton type={p.type ?? "button"} variant={KIND[p.kind ?? "primary"]} size={p.size === "sm" ? "sm" : "default"} disabled={p.disabled || p.busy} onClick={p.onClick} title={p.title} aria-busy={p.busy} className={p.className}>
      {p.busy && <Loader2 className="animate-spin" aria-hidden />}
      {p.children}
    </UIButton>
  );
}

/** Label, control, hint — 8 px apart. */
export function Field(p: { label: ReactNode; hint?: ReactNode; children: ReactNode | ((id: string) => ReactNode) }) {
  const id = useId();
  return (
    <div className="grid gap-2">
      <Label htmlFor={typeof p.children === "function" ? id : undefined}>{p.label}</Label>
      {typeof p.children === "function" ? p.children(id) : p.children}
      {p.hint && <Hint>{p.hint}</Hint>}
    </div>
  );
}
export const Input = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string; inputMode?: "numeric" | "text"; required?: boolean; mono?: boolean; narrow?: boolean }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => <UIInput id={id} className={cn(p.mono && "font-mono text-[0.8125rem]", p.narrow && "max-w-40")} type={p.type ?? "text"} value={p.value} placeholder={p.placeholder} autoComplete={p.autoComplete} inputMode={p.inputMode} required={p.required} onChange={(e) => p.onChange(e.target.value)} />}
  </Field>
);
/** A QR code for a phone camera (drawn as SVG, black on white so every scanner reads it). */
export function QrCode({ text, label, size = 200 }: { text: string; label: string; size?: number }) {
  const { data } = qrEncode(text, { ecc: "M", border: 2 });
  const n = data.length;
  const path = data.flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : ""))).join("");
  return (
    <svg role="img" aria-label={label} viewBox={`0 0 ${n} ${n}`} width={size} height={size} shapeRendering="crispEdges" className="rounded-md border bg-white">
      <path d={path} fill="#000" />
    </svg>
  );
}
/** A compact date picker for page actions (label is for screen readers only). */
export const DateInput = (p: { label: string; value: string; onChange: (v: string) => void; max?: string }) => (
  <UIInput type="date" aria-label={p.label} value={p.value} max={p.max} onChange={(e) => e.target.value && p.onChange(e.target.value)} className="h-8 w-auto" />
);
export const TextArea = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => <Textarea id={id} className={cn(p.mono && "font-mono text-[0.8125rem]")} rows={p.rows ?? 4} value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />}
  </Field>
);
const NONE = "__none__"; // Radix Select does not allow an empty value
export const Select = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => (
      <UISelect value={p.value === "" ? NONE : p.value} onValueChange={(v) => p.onChange(v === NONE ? "" : v)}>
        <SelectTrigger id={id}><SelectValue /></SelectTrigger>
        <SelectContent>
          {p.options.map((o) => <SelectItem key={o.value} value={o.value === "" ? NONE : o.value}>{o.label}</SelectItem>)}
        </SelectContent>
      </UISelect>
    )}
  </Field>
);

/** On/off rows. Several in a row are separated by hairlines. */
export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; badge?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("flex items-center justify-between gap-6 border-t pt-5 first:border-t-0 first:pt-0", p.disabled && "opacity-60")}>
      <div className="min-w-0 space-y-1">
        <Label htmlFor={id} className="flex flex-wrap items-center gap-2 leading-6">{p.label}{p.badge}</Label>
        {p.hint && <Hint>{p.hint}</Hint>}
      </div>
      <Switch id={id} checked={p.checked} disabled={p.disabled} onCheckedChange={p.onChange} />
    </div>
  );
}

/** A few choices shown at once (pick one). */
export function Choice<V extends string>(p: { value: V; onChange: (v: V) => void; options: { value: V; label: ReactNode; hint?: ReactNode }[]; label?: string }) {
  return (
    <RadioGroup value={p.value} onValueChange={(v) => p.onChange(v as V)} aria-label={p.label} className="gap-2">
      {p.options.map((o) => (
        <label key={o.value} className={cn("hover:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 transition-colors", p.value === o.value && "border-primary/60 bg-accent/40")}>
          <RadioGroupItem value={o.value} className="mt-1" />
          <span className="min-w-0 space-y-0.5"><span className="block font-medium">{o.label}</span>{o.hint && <span className="text-muted-foreground block text-[0.8125rem] leading-5">{o.hint}</span>}</span>
        </label>
      ))}
    </RadioGroup>
  );
}

/** A checkbox with a label and an optional hint. */
export function Check(p: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode }) {
  const id = useId();
  return (
    <div className="flex items-start gap-3">
      <Checkbox id={id} checked={p.checked} onCheckedChange={(v) => p.onChange(v === true)} className="mt-1" />
      <label htmlFor={id} className="min-w-0 cursor-pointer space-y-0.5">
        <span className="block">{p.label}</span>
        {p.hint && <span className="text-muted-foreground block text-[0.8125rem] leading-5">{p.hint}</span>}
      </label>
    </div>
  );
}

export function Segmented<V extends string>(p: { value: V; onChange: (v: V) => void; options: { value: V; label: string }[]; label?: string }) {
  return (
    <ToggleGroup type="single" value={p.value} onValueChange={(v) => v && p.onChange(v as V)} aria-label={p.label} className="flex-wrap">
      {p.options.map((o) => <ToggleGroupItem key={o.value} value={o.value}>{o.label}</ToggleGroupItem>)}
    </ToggleGroup>
  );
}

export function Copy({ text, label, block }: { text: string; label?: string; block?: boolean }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="bg-muted flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3">
      <code className={cn("flex-1 bg-transparent p-0", block ? "max-h-72 overflow-y-auto py-1 text-xs leading-5 whitespace-pre-wrap" : "break-all")}>{text}</code>
      <UIButton type="button" variant="outline" size="sm" className="bg-background shrink-0" onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* insecure context: the text stays selectable */ }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}>{done ? <CheckIcon /> : <CopyIcon />}{done ? t("Copied", "복사됨") : label ?? t("Copy", "복사")}</UIButton>
    </div>
  );
}

/** A modal dialog. */
export function Dialog(p: { open: boolean; onClose: () => void; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <UIDialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent className="gap-6">
        <DialogHeader>
          <DialogTitle>{p.title}</DialogTitle>
          {p.sub ? <DialogDescription>{p.sub}</DialogDescription> : <DialogDescription className="sr-only">{p.title}</DialogDescription>}
        </DialogHeader>
        {p.children}
      </DialogContent>
    </UIDialog>
  );
}

/** Confirm before something that cannot be undone. */
export function useConfirm() {
  const { t } = useT();
  return (text: string) => window.confirm(text || t("Are you sure?", "정말 할까요?"));
}
