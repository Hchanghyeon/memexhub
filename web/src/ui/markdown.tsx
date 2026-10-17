import { Children, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { useT } from "../i18n";
import { CALLOUT_MARK, EMBED, HIGHLIGHT, prepare, WIKILINK } from "./markdown-prepare";

export { prepare };

/**
 * Obsidian-flavoured Markdown, read-only: GitHub Markdown (tables, task lists) through react-markdown, plus
 * [[wiki links]], ![[embeds]] (pictures from the vault shown in place, PDFs as links), callouts (folding ones as
 * <details>), ==highlights== and frontmatter. Mermaid blocks stay as code (folded): drawing them would need a large library.
 * Raw HTML is never rendered, and pictures from the internet are shown as links (opening the note must not
 * call outside servers).
 */
export interface VaultFile { url: string; kind: "image" | "pdf"; name: string }
export function Markdown(p: { text: string; open: (target: string) => void; exists: (target: string) => boolean; file?: (target: string) => VaultFile | undefined }) {
  const { t } = useT();
  const { body } = prepare(p.text);
  const components: Components = {
    h1: (x) => <h1 className="mt-8 mb-3 text-2xl font-semibold tracking-tight first:mt-0">{x.children}</h1>,
    h2: (x) => <h2 className="mt-8 mb-3 border-b pb-1.5 text-xl font-semibold tracking-tight first:mt-0">{x.children}</h2>,
    h3: (x) => <h3 className="mt-6 mb-2 text-lg font-semibold">{x.children}</h3>,
    h4: (x) => <h4 className="mt-5 mb-2 font-semibold">{x.children}</h4>,
    h5: (x) => <h5 className="mt-4 mb-2 font-semibold">{x.children}</h5>,
    h6: (x) => <h6 className="text-muted-foreground mt-4 mb-2 font-semibold">{x.children}</h6>,
    p: (x) => <p className="my-3 leading-7">{x.children}</p>,
    ul: (x) => <ul className={cn("my-3 list-disc space-y-1 pl-6", x.className?.includes("contains-task-list") && "list-none pl-1")}>{x.children}</ul>,
    ol: (x) => <ol className="my-3 list-decimal space-y-1 pl-6">{x.children}</ol>,
    li: (x) => {
      if (!x.className?.includes("task-list-item")) return <li className="leading-7">{x.children}</li>;
      // The checkbox beside one text column: links and bold inside the item must stay inline.
      const [box, ...rest] = Children.toArray(x.children);
      return <li className="flex items-start gap-2 leading-7">{box}<div className="min-w-0 flex-1">{rest}</div></li>;
    },
    input: (x) => <input type="checkbox" checked={!!x.checked} disabled readOnly className="accent-primary mt-1.5 size-4 shrink-0" />,
    blockquote: (x) => {
      const c = callout(x.node);
      if (!c) return <blockquote className="bg-muted/40 my-4 rounded-r-lg border-l-4 px-4 py-1 [&>p]:my-2">{x.children}</blockquote>;
      const [head, ...rest] = Children.toArray(x.children).filter((k) => typeof k !== "string" || k.trim());
      const box = cn("bg-muted/40 my-4 rounded-r-lg border-l-4 px-4 py-1 [&>p]:my-2", TONE[c.type] ?? "border-primary/50");
      const title = <div className="font-semibold [&>p]:my-2">{head}</div>;
      if (!c.fold) return <div className={box}>{title}{rest}</div>;
      return (
        <details open={c.fold === "+"} className={cn(box, "group")}>
          <summary className="cursor-pointer list-none [&::-webkit-details-marker]:hidden">
            <span className="flex items-center gap-1.5"><span className="text-muted-foreground text-xs transition-transform group-open:rotate-90">▶</span>{title}</span>
          </summary>
          {rest}
        </details>
      );
    },
    hr: () => <hr className="my-6" />,
    pre: (x) => isMermaid(x.node) ? (
      <details className="my-4 rounded-lg border px-4 py-2">
        <summary className="text-muted-foreground cursor-pointer text-sm">{t("Diagram (Mermaid): drawn in Obsidian, the source is below", "다이어그램(머메이드): 옵시디언에서 그림으로 보여요. 원본은 아래")}</summary>
        <pre className="bg-muted my-2 overflow-x-auto rounded-lg p-4 font-mono text-[0.8125rem] leading-6 [&>code]:bg-transparent [&>code]:p-0">{x.children}</pre>
      </details>
    ) : <pre className="bg-muted my-4 overflow-x-auto rounded-lg p-4 font-mono text-[0.8125rem] leading-6 [&>code]:bg-transparent [&>code]:p-0">{x.children}</pre>,
    code: (x) => <code className={x.className}>{x.children}</code>,
    table: (x) => <div className="my-4 overflow-x-auto rounded-lg border"><table className="w-full text-sm">{x.children}</table></div>,
    thead: (x) => <thead className="bg-muted/50">{x.children}</thead>,
    th: (x) => <th className="border-b px-3 py-2 text-left font-medium">{x.children}</th>,
    td: (x) => <td className="border-b px-3 py-2 align-top [tr:last-child>&]:border-b-0">{x.children}</td>,
    img: (x) => {
      const src = String(x.src ?? "");
      if (src.startsWith(EMBED)) {
        const target = decodeURIComponent(src.slice(EMBED.length));
        const f = p.file?.(target);
        if (f?.kind === "image") return <a href={f.url} target="_blank" rel="noopener noreferrer" className="my-3 block w-fit"><img src={f.url} alt={f.name} loading="lazy" className="max-h-[32rem] max-w-full rounded-lg border" /></a>;
        if (f) return <FileLink f={f} />;
        if (p.exists(target)) return <a href="#" onClick={(e) => { e.preventDefault(); p.open(target); }} className="decoration-primary/40 hover:decoration-primary font-medium underline underline-offset-4">↪ {target}</a>;
        return <span className="text-muted-foreground" title={`${target} (not in the vault)`}>🖼 {target}</span>;
      }
      return src ? <a href={src} target="_blank" rel="noopener noreferrer" className="underline">🖼 {x.alt || src}</a> : <span>🖼 {x.alt}</span>;
    },
    a: (x) => {
      const href = String(x.href ?? "");
      if (href === HIGHLIGHT) return <mark className="rounded bg-yellow-200/70 px-0.5 text-inherit dark:bg-yellow-400/25">{x.children}</mark>;
      if (href.startsWith(CALLOUT_MARK)) return <span>{x.children}</span>;
      if (href.startsWith(WIKILINK)) {
        const target = decodeURIComponent(href.slice(WIKILINK.length));
        if (!target) return <span className="font-medium">{x.children}</span>;
        const ok = p.exists(target);
        const f = ok ? undefined : p.file?.(target);
        if (f) return <FileLink f={f} label={x.children as ReactNode} />;
        return (
          <a href="#" onClick={(e) => { e.preventDefault(); if (ok) p.open(target); }} className={cn("font-medium underline underline-offset-4", ok ? "decoration-primary/40 hover:decoration-primary" : "text-muted-foreground cursor-default decoration-dotted")} title={ok ? target : `${target} (no such note)`}>
            {x.children as ReactNode}
          </a>
        );
      }
      return <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium underline underline-offset-4">{x.children}</a>;
    },
  };
  return (
    <div className="text-[0.9375rem] break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>{body}</ReactMarkdown>
    </div>
  );
}

/** A vault file that is not shown in place: opens in a new tab (the browser's own PDF viewer). */
function FileLink({ f, label }: { f: VaultFile; label?: ReactNode }) {
  return (
    <a href={f.url} target="_blank" rel="noopener noreferrer" className="decoration-primary/40 hover:decoration-primary font-medium underline underline-offset-4">
      {f.kind === "pdf" ? "📄 " : "🖼 "}{label ?? f.name}
    </a>
  );
}

/** Border colour by callout type: amber for warnings, red for danger; the rest use the accent. */
const TONE: Record<string, string> = { warning: "border-amber-500/70", caution: "border-amber-500/70", danger: "border-destructive/70", bug: "border-destructive/70", error: "border-destructive/70" };

interface HastNode { type: string; tagName?: string; properties?: Record<string, unknown>; children?: HastNode[] }
const elements = (n: HastNode | undefined) => (n?.children ?? []).filter((c) => c.type === "element");

/** A quote whose first paragraph is only the callout title link (see prepare) → its type and fold sign. */
function callout(node: unknown): { type: string; fold: string } | undefined {
  const p = elements(node as HastNode)[0];
  const a = p?.tagName === "p" ? elements(p)[0] : undefined;
  const href = String(a?.tagName === "a" ? a.properties?.href ?? "" : "");
  if (!href.startsWith(CALLOUT_MARK)) return undefined;
  const [type = "note", fold = ""] = href.slice(CALLOUT_MARK.length).split(":");
  return { type, fold };
}

function isMermaid(node: unknown): boolean {
  const code = elements(node as HastNode)[0];
  const cls = code?.properties?.className;
  return Array.isArray(cls) && cls.includes("language-mermaid");
}
