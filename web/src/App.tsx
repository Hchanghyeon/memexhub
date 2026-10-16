import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { get, post, setCsrf, whenSignedOut, type Session } from "./api";
import { LangContext, makeT, pickLang, useT } from "./i18n";
import { Link, navigate, useRoute } from "./router";
import { Toasts, Skeleton } from "./ui/kit";
import { Login, Setup, Enrol } from "./pages/Auth";
import { Overview } from "./pages/Overview";
import { Vault } from "./pages/Vault";
import { Connections } from "./pages/Connections";
import { Features } from "./pages/Features";
import { Recipes } from "./pages/Recipes";
import { Claude } from "./pages/Claude";
import { Devices } from "./pages/Devices";
import { Security } from "./pages/Security";
import { Activity } from "./pages/Activity";
import { Backups } from "./pages/Backups";
import { Start } from "./pages/Start";

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
          <div className="center"><div className="card"><Skeleton /></div></div>
        ) : session.setupNeeded ? (
          <Setup onDone={refresh} />
        ) : !session.signedIn ? (
          <Login onDone={refresh} error={session.error} />
        ) : session.mustEnrol ? (
          <Enrol onDone={refresh} />
        ) : (
          <Shell session={session} onSignOut={refresh} />
        )}
      </Toasts>
    </LangContext.Provider>
  );
}

const NAV: { group?: [string, string]; path: string; label: [string, string] }[] = [
  { path: "/", label: ["Overview", "개요"] },
  { group: ["Set up", "설정"], path: "/vault", label: ["Vault", "볼트"] },
  { path: "/claude", label: ["Claude app", "Claude 앱"] },
  { path: "/devices", label: ["Devices", "기기"] },
  { path: "/connections", label: ["Connections", "연결"] },
  { path: "/features", label: ["Features", "기능"] },
  { group: ["Records", "기록"], path: "/recipes", label: ["Recipes & inbox", "레시피·대기함"] },
  { path: "/activity", label: ["Activity", "활동"] },
  { group: ["Safety", "안전"], path: "/security", label: ["Security", "보안"] },
  { path: "/backups", label: ["Backups", "백업"] },
];

function Shell({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { t, lang, setLanguage } = useT();
  const path = useRoute();
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    if (!session.onboarded && path === "/") navigate("/start", true);
  }, [session.onboarded, path]);
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
      default: return <Overview />;
    }
  })();
  const current = NAV.find((n) => n.path === path);
  return (
    <div className={`shell ${menu ? "menu" : ""}`}>
      <aside className="side" onClick={(e) => (e.target as HTMLElement).closest("a") && setMenu(false)}>
        <div className="brand"><span className="brand-mark">m</span>memexhub</div>
        <nav className="nav" aria-label={t("Sections", "메뉴")}>
          {NAV.map((n) => (
            <div key={n.path}>
              {n.group && <div className="nav-group">{t(...n.group)}</div>}
              <Link to={n.path}>{t(...n.label)}</Link>
            </div>
          ))}
        </nav>
        <div className="side-foot">
          <span>{session.username}</span>
          <button type="button" onClick={() => setLanguage(lang === "ko" ? "en" : "ko")}>{lang === "ko" ? "English" : "한국어"}</button>
          <button type="button" onClick={async () => { await post("/logout").catch(() => {}); onSignOut(); }}>{t("Sign out", "로그아웃")}</button>
        </div>
      </aside>
      <main onClick={() => menu && setMenu(false)}>
        <div className="topbar">
          <button type="button" className="icon-btn" aria-label={t("Menu", "메뉴")} onClick={(e) => { e.stopPropagation(); setMenu(true); }}>☰</button>
          <strong>{current ? t(...current.label) : "memexhub"}</strong>
        </div>
        {page}
      </main>
    </div>
  );
}
