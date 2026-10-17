import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post, setCsrf, whenSignedOut, type Session } from "./api";
import { LangContext, makeT, pickLang, useT } from "./i18n";
import { Link, navigate, useRoute } from "./router";
import { Activity as ActivityIcon, Archive, BookOpen, Bot, Cable, FolderOpen, Inbox, Languages, LayoutDashboard, LogOut, Map as MapIcon, Menu, Puzzle, ShieldCheck, Smartphone, type LucideIcon } from "lucide-react";
import { Toasts, Skeleton } from "./ui/kit";
import { Brand } from "./ui/brand";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Login, Setup, Enrol } from "./pages/Auth";
import { Overview } from "./pages/Overview";

// Screens other than the overview load when first opened.
const Vault = lazy(() => import("./pages/Vault").then((m) => ({ default: m.Vault })));
const Connections = lazy(() => import("./pages/Connections").then((m) => ({ default: m.Connections })));
const Features = lazy(() => import("./pages/Features").then((m) => ({ default: m.Features })));
const Recipes = lazy(() => import("./pages/Recipes").then((m) => ({ default: m.Recipes })));
const Claude = lazy(() => import("./pages/Claude").then((m) => ({ default: m.Claude })));
const Devices = lazy(() => import("./pages/Devices").then((m) => ({ default: m.Devices })));
const Security = lazy(() => import("./pages/Security").then((m) => ({ default: m.Security })));
const Activity = lazy(() => import("./pages/Activity").then((m) => ({ default: m.Activity })));
const Backups = lazy(() => import("./pages/Backups").then((m) => ({ default: m.Backups })));
const Start = lazy(() => import("./pages/Start").then((m) => ({ default: m.Start })));
const MapPage = lazy(() => import("./pages/Map").then((m) => ({ default: m.MapPage })));
const Notes = lazy(() => import("./pages/Notes").then((m) => ({ default: m.Notes })));

export function App() {
  const [session, setSession] = useState<Session>();
  const refresh = useCallback(async () => {
    const s: Session = await get<Session>("/session").catch(() => ({ setupNeeded: false, signedIn: false, language: "auto", platform: "" }));
    if (s.csrf) setCsrf(s.csrf);
    setSession(s);
    return s;
  }, []);
  useEffect(() => {
    void refresh();
    whenSignedOut(() => void refresh());
  }, [refresh]);
  const lang = pickLang(session?.language);
  useEffect(() => void (document.documentElement.lang = lang), [lang]);
  const ctx = useMemo(
    () => ({
      lang,
      t: makeT(lang),
      setLanguage: (l: "en" | "ko") => {
        setSession((s) => s && { ...s, language: l });
        if (session?.signedIn) void post("/language", { language: l });
      },
    }),
    [lang, session?.signedIn],
  );
  return (
    <LangContext.Provider value={ctx}>
      <Toasts>
        {!session ? (
          <div className="grid min-h-svh place-items-center px-4"><div className="w-full max-w-sm"><Skeleton /></div></div>
        ) : session.setupNeeded ? (
          <Setup onDone={refresh} />
        ) : !session.signedIn ? (
          <Login onDone={refresh} error={session.error} home={!!session.home} />
        ) : session.mustEnrol ? (
          <Enrol onDone={refresh} />
        ) : (
          <Shell session={session} onSignOut={refresh} />
        )}
      </Toasts>
    </LangContext.Provider>
  );
}

const NAV: { group?: [string, string]; path: string; label: [string, string]; icon: LucideIcon }[] = [
  { path: "/", label: ["Overview", "개요"], icon: LayoutDashboard },
  { path: "/notes", label: ["Notes", "노트"], icon: BookOpen },
  { path: "/map", label: ["Map", "지도"], icon: MapIcon },
  { group: ["Set up", "설정"], path: "/vault", label: ["Vault", "볼트"], icon: FolderOpen },
  { path: "/claude", label: ["Claude app", "Claude 앱"], icon: Bot },
  { path: "/devices", label: ["Devices", "기기"], icon: Smartphone },
  { path: "/connections", label: ["Connections", "연결"], icon: Cable },
  { path: "/features", label: ["Features", "기능"], icon: Puzzle },
  { group: ["Records", "기록"], path: "/recipes", label: ["Payment messages", "결제 메시지"], icon: Inbox },
  { path: "/activity", label: ["Activity", "활동"], icon: ActivityIcon },
  { group: ["Safety", "안전"], path: "/security", label: ["Security", "보안"], icon: ShieldCheck },
  { path: "/backups", label: ["Backups", "백업"], icon: Archive },
];

function Sidebar({ session, path, onSignOut, onNavigate }: { session: Session; path: string; onSignOut: () => void; onNavigate?: () => void }) {
  const { t, lang, setLanguage } = useT();
  return (
    <div className="flex h-full flex-col gap-1 px-3 py-4">
      <div className="flex h-10 items-center gap-2.5 px-2.5 text-[0.9375rem] font-semibold"><Brand />memexhub</div>
      <nav className="flex flex-col gap-0.5" aria-label={t("Sections", "메뉴")}>
        {NAV.map((n) => (
          <div key={n.path} className="contents">
            {n.group && <div className="text-muted-foreground px-2.5 pt-5 pb-1 text-xs font-medium">{t(...n.group)}</div>}
            <Link to={n.path} onClick={onNavigate} className={cn("text-muted-foreground hover:bg-accent hover:text-foreground flex h-8 items-center gap-2.5 rounded-md px-2.5 text-sm no-underline transition-colors [&_svg]:size-4", (path === n.path || (n.path !== "/" && path.startsWith(`${n.path}/`))) && "bg-accent text-foreground font-medium")}>
              <n.icon />{t(...n.label)}
            </Link>
          </div>
        ))}
      </nav>
      <div className="mt-auto flex flex-col gap-0.5 border-t pt-3">
        <div className="text-muted-foreground px-2.5 pb-1 text-xs break-all">{session.username}</div>
        <Button variant="ghost" size="sm" className="text-muted-foreground justify-start" onClick={() => setLanguage(lang === "ko" ? "en" : "ko")}><Languages />{lang === "ko" ? "English" : "한국어"}</Button>
        <Button variant="ghost" size="sm" className="text-muted-foreground justify-start" onClick={async () => { await post("/logout").catch(() => {}); onSignOut(); }}><LogOut />{t("Sign out", "로그아웃")}</Button>
      </div>
    </div>
  );
}

function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { t } = useT();
  const path = useRoute();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!session.onboarded && path === "/") navigate("/start", true);
  }, [session.onboarded, path]);
  useEffect(() => {
    window.scrollTo(0, 0); // returns a Promise in newer browsers: never let it become the effect cleanup
  }, [path]);
  const page: ReactNode = (() => {
    switch (path) {
      case "/": return <Overview />;
      case "/start": return <Start onDone={onSignOut} />;
      case "/vault": return <Vault />;
      case "/connections": return <Connections />;
      case "/features": return <Features />;
      case "/recipes": return <Recipes />;
      case "/claude": return <Claude />;
      case "/devices": return <Devices />;
      case "/security": return <Security />;
      case "/activity": return <Activity />;
      case "/backups": return <Backups />;
      case "/map": return <MapPage />;
      default: return path === "/notes" || path.startsWith("/notes/") ? <Notes route={path} /> : <Overview />;
    }
  })();
  const current = NAV.find((n) => n.path === path || (n.path !== "/" && path.startsWith(`${n.path}/`)));
  return (
    <div className="bg-background min-h-svh md:grid md:grid-cols-[240px_1fr]">
      <aside className="bg-sidebar sticky top-0 hidden h-svh overflow-y-auto border-r md:block">
        <Sidebar session={session} path={path} onSignOut={onSignOut} />
      </aside>
      <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-72 p-0" aria-describedby={undefined}>
          <SheetTitle className="sr-only">{t("Menu", "메뉴")}</SheetTitle>
          <Sidebar session={session} path={path} onSignOut={onSignOut} onNavigate={() => setMenu(false)} />
        </SheetContent>
      </Sheet>
      <main className="min-w-0">
        <div className="bg-background/85 sticky top-0 z-20 flex items-center gap-2 border-b px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur md:hidden">
          <Button variant="ghost" size="icon" aria-label={t("Menu", "메뉴")} onClick={() => setMenu(true)}><Menu /></Button>
          <strong className="text-[0.95rem]">{current ? t(...current.label) : "memexhub"}</strong>
        </div>
        <Suspense fallback={<div className="mx-auto w-full max-w-3xl px-4 pt-12 sm:px-8"><Skeleton lines={4} /></div>}>{page}</Suspense>
      </main>
    </div>
  );
}
