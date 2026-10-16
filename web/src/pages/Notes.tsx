import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, FileText, Folder, Search, X } from "lucide-react";
import { get } from "../api";
import { useT, when } from "../i18n";
import { navigate } from "../router";
import { cn } from "@/lib/utils";
import { Input as UIInput } from "@/components/ui/input";
import { Button, Callout, Card, Empty, Loading, Skeleton, errorText, useData } from "../ui/kit";
import { Markdown, prepare } from "../ui/markdown";

interface F { path: string; size: number; mtime: string }
type Tree = { dirs: Map<string, Tree>; notes: F[] };
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const nameOf = (p: string) => p.split("/").pop()!.replace(/\.md$/i, "");
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** Screen path ↔ note path: /notes/<segments> (each segment URL-encoded). */
export const notePathOf = (route: string) => route.replace(/^\/notes\/?/, "").split("/").filter(Boolean).map(decodeURIComponent).join("/");
const openNote = (path: string) => navigate(`/notes/${path.split("/").map(encodeURIComponent).join("/")}`);

function build(files: F[]): Tree {
  const root: Tree = { dirs: new Map(), notes: [] };
  for (const f of files) {
    if (!/\.md$/i.test(f.path)) continue;
    const parts = f.path.split("/");
    let t = root;
    for (const d of parts.slice(0, -1)) {
      if (!t.dirs.has(d)) t.dirs.set(d, { dirs: new Map(), notes: [] });
      t = t.dirs.get(d)!;
    }
    t.notes.push(f);
  }
  return root;
}

/** [[target]] → a note path: exact path first, then the shortest path whose file name matches. */
export function resolver(files: F[]) {
  const notes = files.filter((f) => /\.md$/i.test(f.path)).map((f) => f.path);
  const byPath = new Map(notes.map((p) => [p.toLowerCase(), p]));
  const byName = new Map<string, string>();
  for (const p of [...notes].sort((a, b) => a.length - b.length)) {
    const n = nameOf(p).toLowerCase();
    if (!byName.has(n)) byName.set(n, p);
  }
  return (target: string) => {
    const t = target.trim().replace(/\.md$/i, "").toLowerCase();
    return byPath.get(`${t}.md`) ?? byName.get(t.split("/").pop()!) ?? undefined;
  };
}

export function Notes({ route }: { route: string }) {
  const { t } = useT();
  const { data, error, reload } = useData<{ files: F[]; truncated: boolean }>("/vault/files");
  const path = notePathOf(route);
  const resolve = useMemo(() => resolver(data?.files ?? []), [data]);
  if (!data) return <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-8"><Loading error={error} reload={reload} /></div>;
  return (
    <div className="md:grid md:min-h-svh md:grid-cols-[300px_1fr]">
      <aside className={cn("md:bg-sidebar/50 border-r md:sticky md:top-0 md:h-svh md:overflow-y-auto", path && "hidden md:block")}>
        <Browser files={data.files} current={path} truncated={data.truncated} />
      </aside>
      <section className={cn("min-w-0", !path && "hidden md:block")}>
        {path ? <Note key={path} path={path} resolve={resolve} files={data.files} /> : (
          <div className="mx-auto max-w-3xl px-4 pt-16 sm:px-8"><Empty>{t("Pick a note on the left, or search.", "왼쪽에서 노트를 고르거나 찾아보세요.")}</Empty></div>
        )}
      </section>
    </div>
  );
}

function Browser({ files, current, truncated }: { files: F[]; current: string; truncated: boolean }) {
  const { t } = useT();
  const tree = useMemo(() => build(files), [files]);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ path: string; lines: { n: number; text: string }[] }[]>();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<Set<string>>(() => new Set(current.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))));
  useEffect(() => {
    // Opening a note unfolds the folders above it.
    setOpen((o) => new Set([...o, ...current.split("/").slice(0, -1).map((_, i, a) => a.slice(0, i + 1).join("/"))]));
  }, [current]);
  const search = async () => {
    if (!q.trim()) return setHits(undefined);
    setBusy(true);
    try {
      setHits((await get<{ hits: typeof hits }>(`/vault/search?q=${encodeURIComponent(q.trim())}`)).hits);
    } finally {
      setBusy(false);
    }
  };
  const count = files.filter((f) => /\.md$/i.test(f.path)).length;
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="px-1 pt-2">
        <h1 className="text-lg font-semibold tracking-tight">{t("Notes", "노트")}</h1>
        <p className="text-muted-foreground text-[0.8125rem]">{t(`${count} notes in the vault · read-only`, `볼트의 노트 ${count}개 · 읽기 전용`)}</p>
      </div>
      <form className="relative" onSubmit={(e) => { e.preventDefault(); void search(); }}>
        <Search className="text-muted-foreground absolute top-2.5 left-2.5 size-4" aria-hidden />
        <UIInput value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value) setHits(undefined); }} placeholder={t("Search all notes", "모든 노트에서 찾기")} aria-label={t("Search", "찾기")} className="bg-background pr-8 pl-8" />
        {q && <button type="button" aria-label={t("Clear", "지우기")} onClick={() => { setQ(""); setHits(undefined); }} className="text-muted-foreground hover:text-foreground absolute top-2.5 right-2.5 cursor-pointer"><X className="size-4" /></button>}
      </form>
      {truncated && <Callout tone="warning"><p>{t("Only the first 20,000 files are listed.", "파일이 많아 처음 20,000개만 보여요.")}</p></Callout>}
      {busy ? <Skeleton lines={4} /> : hits ? (
        <div className="flex flex-col gap-1">
          <p className="text-muted-foreground px-1 text-[0.8125rem]">{t(`${hits.length} notes`, `노트 ${hits.length}개`)}</p>
          {hits.map((h) => (
            <button key={h.path} type="button" onClick={() => openNote(h.path)} className={cn("hover:bg-accent cursor-pointer rounded-md px-2 py-2 text-left", h.path === current && "bg-accent")}>
              <span className="block truncate text-sm font-medium" title={h.path}>{nameOf(h.path)}</span>
              <span className="text-muted-foreground block text-xs break-all">{h.path}</span>
              {h.lines[0] && <span className="text-muted-foreground mt-1 line-clamp-2 block text-xs">{h.lines[0].text}</span>}
            </button>
          ))}
          {!hits.length && <Empty>{t("No matches.", "찾은 노트가 없어요.")}</Empty>}
        </div>
      ) : (
        <nav aria-label={t("Folders", "폴더")}><TreeView tree={tree} prefix="" open={open} setOpen={setOpen} current={current} depth={0} /></nav>
      )}
    </div>
  );
}

function TreeView(p: { tree: Tree; prefix: string; open: Set<string>; setOpen: (s: Set<string>) => void; current: string; depth: number }) {
  const dirs = [...p.tree.dirs.keys()].sort(collator.compare);
  const notes = [...p.tree.notes].sort((a, b) => collator.compare(nameOf(a.path), nameOf(b.path)));
  const pad = { paddingLeft: `${p.depth * 14 + 8}px` };
  return (
    <ul className="flex flex-col">
      {dirs.map((d) => {
        const full = p.prefix ? `${p.prefix}/${d}` : d;
        const isOpen = p.open.has(full);
        return (
          <li key={full}>
            <button type="button" style={pad} aria-expanded={isOpen} onClick={() => { const n = new Set(p.open); if (isOpen) n.delete(full); else n.add(full); p.setOpen(n); }} className="hover:bg-accent flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm">
              <ChevronRight className={cn("text-muted-foreground size-3.5 shrink-0 transition-transform", isOpen && "rotate-90")} aria-hidden />
              <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden />
              <span className="break-all">{d}</span>
            </button>
            {isOpen && <TreeView {...p} tree={p.tree.dirs.get(d)!} prefix={full} depth={p.depth + 1} />}
          </li>
        );
      })}
      {notes.map((n) => (
        <li key={n.path}>
          <button type="button" style={{ paddingLeft: `${p.depth * 14 + 28}px` }} onClick={() => openNote(n.path)} aria-current={n.path === p.current ? "page" : undefined} className={cn("hover:bg-accent flex w-full cursor-pointer items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm", n.path === p.current && "bg-accent font-medium")}>
            <FileText className="text-muted-foreground size-4 shrink-0" aria-hidden />
            <span className="break-all">{nameOf(n.path)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Note({ path, resolve, files }: { path: string; resolve: (t: string) => string | undefined; files: F[] }) {
  const { t } = useT();
  const { data, error } = useData<{ path: string; text: string }>(`/vault/note?path=${encodeURIComponent(path)}`);
  const info = files.find((f) => f.path === path);
  const folders = path.split("/").slice(0, -1);
  return (
    <article className="mx-auto w-full max-w-3xl px-4 pt-4 pb-24 sm:px-8 md:pt-10">
      <div className="mb-4 md:hidden"><Button kind="ghost" size="sm" onClick={() => navigate("/notes")}><ArrowLeft />{t("All notes", "노트 목록")}</Button></div>
      <header className="mb-6 space-y-1.5 border-b pb-5">
        {folders.length > 0 && <p className="text-muted-foreground text-[0.8125rem] break-all">{folders.join(" / ")}</p>}
        <h1 className="text-2xl font-semibold tracking-tight break-words">{nameOf(path)}</h1>
        {info && <p className="text-muted-foreground text-[0.8125rem]">{t(`Changed ${when(info.mtime, tz)}`, `${when(info.mtime, tz)} 수정`)}</p>}
        {data && <Meta text={data.text} />}
      </header>
      {error ? <Card><Callout tone="error"><p>{errorText(t, error)}</p></Callout></Card> : !data ? <Skeleton lines={8} /> : (
        <Markdown text={withoutTitle(data.text, nameOf(path))} exists={(x) => !!resolve(x)} open={(x) => { const p = resolve(x); if (p) openNote(p); }} />
      )}
    </article>
  );
}

/** Notes usually start with "# <file name>"; the header already shows it, so it is not repeated. */
function withoutTitle(text: string, name: string) {
  const fm = text.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/)?.[0] ?? "";
  const rest = text.slice(fm.length).replace(/^\s*\n/, "");
  const first = rest.match(/^#\s+(.+?)\s*#*\s*(\r?\n|$)/);
  return first && first[1]!.trim().toLowerCase() === name.trim().toLowerCase() ? fm + rest.slice(first[0].length) : text;
}

function Meta({ text }: { text: string }) {
  const { meta } = prepare(text);
  const shown = meta.filter(([k]) => !["title", "created"].includes(k));
  if (!shown.length) return null;
  return (
    <dl className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[0.8125rem]">
      {shown.map(([k, v]) => (
        <div key={k} className="flex gap-1.5"><dt className="text-muted-foreground">{k}</dt><dd className="break-all">{v}</dd></div>
      ))}
    </dl>
  );
}
