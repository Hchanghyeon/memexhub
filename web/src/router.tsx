import { useEffect, useState } from "react";

/** A tiny router: paths under /admin, history API, no dependency. */
const PREFIX = "/admin";
const current = () => location.pathname.replace(/^\/admin\/?/, "/").replace(/\/+$/, "") || "/";
const listeners = new Set<() => void>();

export function navigate(path: string, replace = false) {
  const url = PREFIX + (path === "/" ? "/" : path);
  if (replace) history.replaceState(null, "", url);
  else history.pushState(null, "", url);
  listeners.forEach((l) => l());
  window.scrollTo({ top: 0 });
}

export function useRoute() {
  const [path, setPath] = useState(current());
  useEffect(() => {
    const on = () => setPath(current());
    listeners.add(on);
    window.addEventListener("popstate", on);
    return () => {
      listeners.delete(on);
      window.removeEventListener("popstate", on);
    };
  }, []);
  return path;
}

export function Link(p: { to: string; className?: string; children: React.ReactNode; onClick?: () => void }) {
  return (
    <a
      href={PREFIX + (p.to === "/" ? "/" : p.to)}
      className={p.className}
      aria-current={current() === p.to ? "page" : undefined}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        p.onClick?.();
        navigate(p.to);
      }}
    >
      {p.children}
    </a>
  );
}
