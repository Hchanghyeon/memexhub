import { useCallback, useEffect, useId, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Check, Copy as CopyIcon, Loader2 } from "lucide-react";
import { ApiError, get } from "../api";
import { useT, type T } from "../i18n";
import { cn } from "@/lib/utils";
import { Button as UIButton } from "@/components/ui/button";
import { Card as UICard, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge as UIBadge } from "@/components/ui/badge";
import { Input as UIInput } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton as UISkeleton } from "@/components/ui/skeleton";
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

// ---------- layout pieces ----------
export const Page = (p: { title: string; sub?: ReactNode; actions?: ReactNode; children: ReactNode }) => (
  <div className="mx-auto w-full max-w-4xl px-4 pt-6 pb-20 sm:px-6 md:pt-10">
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight md:text-[1.7rem]">{p.title}</h1>
        {p.sub && <p className="text-muted-foreground text-sm">{p.sub}</p>}
      </div>
      {p.actions && <div className="flex flex-wrap items-center gap-2">{p.actions}</div>}
    </header>
    <div className="flex flex-col gap-4">{p.children}</div>
  </div>
);

export const Card = (p: { title?: ReactNode; badge?: ReactNode; sub?: ReactNode; id?: string; children?: ReactNode; className?: string; aside?: ReactNode }) => (
  <UICard id={p.id} className={cn("gap-4 py-5", p.className)}>
    {(p.title || p.aside) && (
      <CardHeader className="px-5">
        {p.title && <CardTitle className="flex flex-wrap items-center gap-2 text-base">{p.title} {p.badge}</CardTitle>}
        {p.sub && <CardDescription>{p.sub}</CardDescription>}
        {p.aside && <CardAction>{p.aside}</CardAction>}
      </CardHeader>
    )}
    {p.children !== undefined && <CardContent className="px-5">{p.children}</CardContent>}
  </UICard>
);

const BADGE = { required: "destructive", recommended: "info", optional: "outline", basic: "secondary", neutral: "outline" } as const;
export const Badge = (p: { tone?: keyof typeof BADGE; children: ReactNode }) => <UIBadge variant={BADGE[p.tone ?? "neutral"]}>{p.children}</UIBadge>;

const DOT = { ok: "bg-success", err: "bg-destructive", warn: "bg-warning", idle: "bg-muted-foreground/40" };
export const Dot = (p: { tone: keyof typeof DOT }) => <span className={cn("mr-2 inline-block size-2 shrink-0 rounded-full", DOT[p.tone])} aria-hidden />;

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
      <p className="text-destructive mb-3 text-sm">{errorText(t, error)}</p>
      {reload && <Button kind="secondary" onClick={reload}>{t("Try again", "다시 시도")}</Button>}
    </Card>
  );
}

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

export function Field(p: { label: ReactNode; hint?: ReactNode; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <Label htmlFor={id}>{p.label}</Label>
      {p.children(id)}
      {p.hint && <p className="hint">{p.hint}</p>}
    </div>
  );
}
export const Input = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; type?: string; placeholder?: string; autoComplete?: string; inputMode?: "numeric" | "text"; required?: boolean; mono?: boolean }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => <UIInput id={id} className={p.mono ? "font-mono" : undefined} type={p.type ?? "text"} value={p.value} placeholder={p.placeholder} autoComplete={p.autoComplete} inputMode={p.inputMode} required={p.required} onChange={(e) => p.onChange(e.target.value)} />}
  </Field>
);
export const TextArea = (p: { label: ReactNode; hint?: ReactNode; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; mono?: boolean }) => (
  <Field label={p.label} hint={p.hint}>
    {(id) => <Textarea id={id} className={p.mono ? "font-mono text-xs" : undefined} rows={p.rows ?? 4} value={p.value} placeholder={p.placeholder} onChange={(e) => p.onChange(e.target.value)} />}
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
/** On/off switch with a title and a one-line explanation. */
export function Toggle(p: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; hint?: ReactNode; disabled?: boolean; badge?: ReactNode }) {
  const id = useId();
  return (
    <div className={cn("flex items-center justify-between gap-4 border-t py-3.5 first:border-t-0 first:pt-0 last:pb-0", p.disabled && "opacity-60")}>
      <div className="space-y-1">
        <Label htmlFor={id} className="flex flex-wrap items-center gap-2 text-[0.95rem] font-semibold">{p.label} {p.badge}</Label>
        {p.hint && <p className="text-muted-foreground text-sm">{p.hint}</p>}
      </div>
      <Switch id={id} checked={p.checked} disabled={p.disabled} onCheckedChange={p.onChange} />
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

export function Copy({ text, label }: { text: string; label?: string }) {
  const { t } = useT();
  const [done, setDone] = useState(false);
  return (
    <div className="bg-muted my-2 flex items-center gap-2 rounded-lg py-1.5 pr-1.5 pl-3">
      <code className="flex-1 bg-transparent p-0 text-[0.82rem] break-all">{text}</code>
      <UIButton variant="outline" size="sm" className="bg-background shrink-0" onClick={async () => {
        try { await navigator.clipboard.writeText(text); } catch { /* insecure context: the text stays selectable */ }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}>{done ? <Check /> : <CopyIcon />}{done ? t("Copied", "복사됨") : label ?? t("Copy", "복사")}</UIButton>
    </div>
  );
}

/** A modal dialog. */
export function Dialog(p: { open: boolean; onClose: () => void; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <UIDialog open={p.open} onOpenChange={(o) => !o && p.onClose()}>
      <DialogContent>
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

export const Empty = (p: { children: ReactNode }) => <p className="text-muted-foreground py-6 text-center text-sm">{p.children}</p>;
