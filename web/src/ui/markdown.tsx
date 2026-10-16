import type { ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";
import { prepare, WIKILINK } from "./markdown-prepare";

export { prepare };

/**
 * Obsidian-flavoured Markdown, read-only: GitHub Markdown (tables, task lists) through react-markdown, plus
 * [[wiki links]], ![[embeds]] (shown by name), callouts and frontmatter. Raw HTML is never rendered, and
 * pictures from the internet are shown as links (opening the note must not call outside servers).
 */
export function Markdown(p: { text: string; open: (target: string) => void; exists: (target: string) => boolean }) {
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
    li: (x) => <li className={cn("leading-7", x.className?.includes("task-list-item") && "flex items-start gap-2 [&>ul]:w-full")}>{x.children}</li>,
    input: (x) => <input type="checkbox" checked={!!x.checked} disabled readOnly className="accent-primary mt-1.5 size-4 shrink-0" />,
    blockquote: (x) => <blockquote className="bg-muted/40 my-4 rounded-r-lg border-l-4 px-4 py-1 [&>p]:my-2">{x.children}</blockquote>,
    hr: () => <hr className="my-6" />,
    pre: (x) => <pre className="bg-muted my-4 overflow-x-auto rounded-lg p-4 font-mono text-[0.8125rem] leading-6 [&>code]:bg-transparent [&>code]:p-0">{x.children}</pre>,
    code: (x) => <code className={x.className}>{x.children}</code>,
    table: (x) => <div className="my-4 overflow-x-auto rounded-lg border"><table className="w-full text-sm">{x.children}</table></div>,
    thead: (x) => <thead className="bg-muted/50">{x.children}</thead>,
    th: (x) => <th className="border-b px-3 py-2 text-left font-medium">{x.children}</th>,
    td: (x) => <td className="border-b px-3 py-2 align-top [tr:last-child>&]:border-b-0">{x.children}</td>,
    img: (x) => (x.src ? <a href={String(x.src)} target="_blank" rel="noopener noreferrer" className="underline">🖼 {x.alt || String(x.src)}</a> : <span>🖼 {x.alt}</span>),
    a: (x) => {
      const href = String(x.href ?? "");
      if (href.startsWith(WIKILINK)) {
        const target = decodeURIComponent(href.slice(WIKILINK.length));
        if (!target) return <span className="font-medium">{x.children}</span>;
        const ok = p.exists(target);
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
