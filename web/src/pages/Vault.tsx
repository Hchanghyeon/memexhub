import { useEffect, useState } from "react";
import { post } from "../api";
import { ago, useT } from "../i18n";
import { Badge, Button, Card, Check, Choice, Field, Fields, Input, Loading, More, Page, Segmented, Select, Status, Steps, Toggle, useAction, useData } from "../ui/kit";

interface V {
  connected: boolean; provider: string | null; choice: { provider?: string; path?: string; url?: string; username?: string; notionPage?: string };
  roots: string[]; runtime: string;
  dav: { enabled: boolean; maxFileMb: number; available: boolean };
  search: { available: boolean; ready: boolean; notes: number; updated: string | null } | null;
  history: { on: boolean; available: boolean; stats: { commits: number } | null };
  wiki: { preset: string | null; presets: string[]; gate: boolean; roles: { sources?: string; wiki?: string; index: { style: string; file?: string }; log?: string; daily?: string; rules: string[]; archive?: string }; lint: { id: string; enabled: boolean }[] };
}

const PRESET_TEXT: Record<string, [string, string]> = {
  "llm-wiki": ["Sources in raw/, pages Claude writes in wiki/: for a new vault", "원본은 raw/, Claude가 쓰는 페이지는 wiki/: 새 볼트에 추천"],
  para: ["Projects, Areas, Resources, Archives", "Projects, Areas, Resources, Archives (영어 폴더)"],
  "para-ko": ["PARA with Korean folder names", "한국어 폴더 이름의 PARA"],
  zettelkasten: ["One folder of linked notes", "연결된 노트 한 폴더"],
  flat: ["Everything in one folder", "모두 한 폴더에"],
};

export function Vault() {
  const { t } = useT();
  const { data: v, error, reload } = useData<V>("/vault");
  if (!v) return <Page title={t("Vault", "볼트")}><Loading error={error} reload={reload} /></Page>;
  return (
    <Page title={t("Vault", "볼트")} sub={t("The folder of Markdown notes that is your wiki. Claude reads and writes it through memexhub.", "위키가 되는 마크다운 노트 폴더예요. Claude는 memexhub를 거쳐 이걸 읽고 써요.")}>
      <Storage v={v} reload={reload} />
      <Layout v={v} reload={reload} />
      <Sync v={v} reload={reload} />
    </Page>
  );
}

function Storage({ v, reload }: { v: V; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(!v.connected);
  const [f, setF] = useState({ provider: v.choice.provider ?? (v.runtime === "workers" ? "r2" : "builtin"), path: v.choice.path ?? "", url: v.choice.url ?? "", username: v.choice.username ?? "", password: "", allowPrivateNetwork: false, notionPage: v.choice.notionPage ?? "", notionToken: "" });
  const options = [
    ...(v.runtime === "workers" ? [{ value: "r2", label: t("This Worker's R2 bucket (recommended)", "이 Worker의 R2 버킷 (추천)") }] : [{ value: "builtin", label: t("New folder on this server (recommended)", "이 서버에 새 폴더 (추천)") }, { value: "folder", label: t("A folder that already exists on this server", "이 서버에 이미 있는 폴더") }]),
    { value: "webdav", label: t("WebDAV (Nextcloud, NAS)", "WebDAV (Nextcloud, NAS)") },
    { value: "notion", label: t("Notion (beta, small vaults)", "Notion (베타, 작은 볼트)") },
  ];
  const where = v.choice.path ?? v.choice.url ?? v.choice.notionPage ?? "";
  const save = () => run(() => post("/vault", f), t("Vault connected.", "볼트를 연결했어요."), () => { setOpen(false); reload(); });
  return (
    <Card title={t("Where your notes live", "노트가 있는 곳")} badge={<Badge tone="required">{t("Required", "필수")}</Badge>}
      aside={v.connected && !open ? <Button kind="secondary" size="sm" onClick={() => setOpen(true)}>{t("Change", "바꾸기")}</Button> : undefined}
      onSubmit={open ? () => void save() : undefined}
      footer={open && <><Button type="submit" busy={busy}>{t("Save and test", "저장하고 시험")}</Button>{v.connected && <Button kind="ghost" onClick={() => setOpen(false)}>{t("Cancel", "취소")}</Button>}</>}>
      <div className="flex flex-wrap items-center gap-3">
        <Status tone={v.connected ? "ok" : "err"}>{v.connected ? t("Connected", "연결됨") : t("Not connected", "연결 안 됨")}</Status>
        {where && <code>{where}</code>}
      </div>
      {v.connected && v.search && <SearchIndexLine s={v.search} reload={reload} />}
      {v.connected && <HistoryLine h={v.history} reload={reload} />}
      {open && (
        <>
          <Select label={t("Kind", "종류")} value={f.provider} onChange={(p) => setF({ ...f, provider: p })} options={options} />
          {f.provider === "folder" && <Input label={t("Folder", "폴더")} hint={t(`Inside ${v.roots.join(" or ")}`, `${v.roots.join(" 또는 ")} 안`)} value={f.path} onChange={(x) => setF({ ...f, path: x })} placeholder={`${v.roots[0] ?? ""}/my-vault`} mono />}
          {f.provider === "webdav" && (
            <>
              <Input label="WebDAV URL" value={f.url} onChange={(x) => setF({ ...f, url: x })} placeholder="https://dav.example.com/vault" mono />
              <Fields>
                <Input label={t("Username", "아이디")} value={f.username} onChange={(x) => setF({ ...f, username: x })} autoComplete="off" />
                <Input label={t("Password", "비밀번호")} hint={t("Stored encrypted. Leave empty to keep the current one.", "암호화해 저장해요. 비우면 지금 값을 그대로 둬요.")} type="password" value={f.password} onChange={(x) => setF({ ...f, password: x })} autoComplete="new-password" />
              </Fields>
              <Check checked={f.allowPrivateNetwork} onChange={(x) => setF({ ...f, allowPrivateNetwork: x })} label={t("The WebDAV server is on my home network", "WebDAV 서버가 집 네트워크에 있어요")} />
            </>
          )}
          {f.provider === "notion" && (
            <>
              <Input label={t("Notion page", "Notion 페이지")} hint={t("Share it with your integration first.", "먼저 통합(integration)과 공유하세요.")} value={f.notionPage} onChange={(x) => setF({ ...f, notionPage: x })} placeholder="https://www.notion.so/…" />
              <Input label={t("Integration secret", "통합 비밀값")} type="password" value={f.notionToken} onChange={(x) => setF({ ...f, notionToken: x })} autoComplete="new-password" />
            </>
          )}
        </>
      )}
    </Card>
  );
}

function Layout({ v, reload }: { v: V; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [preset, setPreset] = useState(v.wiki.preset ?? "");
  const r = v.wiki.roles;
  const [roles, setRoles] = useState({ sources: r.sources ?? "", wiki: r.wiki === "" ? "/" : r.wiki ?? "", index: r.index.style, indexFile: r.index.file ?? "index.md", log: r.log ?? "", daily: r.daily ?? "", rules: r.rules.join(", "), archive: r.archive ?? "" });
  const [lint, setLint] = useState(v.wiki.lint);
  useEffect(() => setPreset(v.wiki.preset ?? ""), [v.wiki.preset]);
  return (
    <Card title={t("Wiki layout", "위키 구조")} badge={<Badge>{t("Optional", "선택")}</Badge>} sub={t("memexhub knows roles, not folder names. Pick the closest preset.", "memexhub는 폴더 이름이 아니라 역할을 알아요. 가장 비슷한 프리셋을 고르세요.")}
      footer={<Button busy={busy} disabled={!preset || preset === v.wiki.preset} onClick={() => run(() => post("/wiki/preset", { preset }), t("Layout applied.", "구조를 적용했어요."), reload)}>{t("Use this layout", "이 구조 쓰기")}</Button>}>
      <Choice value={preset} onChange={setPreset} label={t("Layout", "구조")} options={v.wiki.presets.map((p) => ({ value: p, label: p, hint: PRESET_TEXT[p] ? t(...PRESET_TEXT[p]!) : undefined }))} />
      <More summary={t("Folders for each role", "역할별 폴더 직접 정하기")}>
        <Fields>
          <Input label={t("Sources folder (write-once)", "원본 폴더 (한 번만 쓰기)")} value={roles.sources} onChange={(x) => setRoles({ ...roles, sources: x })} placeholder="raw" mono />
          <Input label={t("Wiki folder", "위키 폴더")} hint={t('Empty = off, "/" = the whole vault.', '비우면 끔, "/"는 볼트 전체.')} value={roles.wiki} onChange={(x) => setRoles({ ...roles, wiki: x })} mono />
        </Fields>
        <Field label={t("Index style", "색인 방식")}>
          <Segmented value={roles.index} onChange={(x) => setRoles({ ...roles, index: x })} options={[{ value: "none", label: t("No index", "색인 없음") }, { value: "folder-note", label: t("Folder note", "폴더 노트") }, { value: "index-file", label: t("Index file", "색인 파일") }]} />
        </Field>
        {roles.index === "index-file" && <Input label={t("Index file name", "색인 파일 이름")} value={roles.indexFile} onChange={(x) => setRoles({ ...roles, indexFile: x })} mono />}
        <Fields>
          <Input label={t("Log note", "기록 노트")} value={roles.log} onChange={(x) => setRoles({ ...roles, log: x })} mono />
          <Input label={t("Daily notes", "일일 노트")} value={roles.daily} onChange={(x) => setRoles({ ...roles, daily: x })} placeholder="Journal/{YYYY-MM-DD}.md" mono />
        </Fields>
        <Input label={t("Rule notes Claude may not change", "Claude가 못 고치는 규칙 노트")} hint={t("Comma separated, * allowed.", "쉼표로 구분, * 사용 가능.")} value={roles.rules} onChange={(x) => setRoles({ ...roles, rules: x })} mono />
        <Input label={t("Archive folder", "보관 폴더")} value={roles.archive} onChange={(x) => setRoles({ ...roles, archive: x })} mono />
        <div><Button kind="secondary" busy={busy} onClick={() => run(() => post("/wiki/roles", { ...roles, rules: roles.rules.split(",") }), t("Layout saved.", "구조를 저장했어요."), reload)}>{t("Save folders", "폴더 저장")}</Button></div>
      </More>
      <Toggle checked={v.wiki.gate} disabled={busy} onChange={(on) => run(() => post("/wiki/gate", { on }), t("Saved.", "저장했어요."), reload)}
        label={t("Check pages Claude writes", "Claude가 쓰는 페이지 검사")}
        hint={t("A wiki page needs frontmatter and a link to an existing source, or it is not saved. Pages are saved as drafts until you confirm them in Notes.", "위키 페이지는 프론트매터와 실제 원본 링크가 있어야 저장돼요. 노트 화면에서 확인하기 전까지는 '검토 필요'로 저장돼요.")} />
      <More summary={t("Wiki checks", "위키 점검 규칙")}>
        <div className="grid gap-3 sm:grid-cols-2">
          {lint.map((l) => <Check key={l.id} checked={l.enabled} onChange={(on) => setLint(lint.map((x) => (x.id === l.id ? { ...x, enabled: on } : x)))} label={<code>{l.id}</code>} />)}
        </div>
        <div><Button kind="secondary" busy={busy} onClick={() => run(() => post("/wiki/lint", { on: lint.filter((x) => x.enabled).map((x) => x.id) }), t("Saved.", "저장했어요."), reload)}>{t("Save checks", "점검 규칙 저장")}</Button></div>
      </More>
    </Card>
  );
}

function Sync({ v, reload }: { v: V; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [mb, setMb] = useState(String(v.dav.maxFileMb));
  if (!v.dav.available) return null;
  const save = (enabled: boolean) => run(() => post("/dav", { enabled, maxFileMb: Number(mb) || 50 }), t("Saved.", "저장했어요."), reload);
  return (
    <Card title={t("Sync with Obsidian on your devices", "기기의 Obsidian과 동기화")} badge={<Badge>{t("Optional", "선택")}</Badge>}
      footer={v.dav.enabled && <Button kind="secondary" busy={busy} onClick={() => void save(true)}>{t("Save", "저장")}</Button>}>
      <Toggle checked={v.dav.enabled} disabled={busy} onChange={(on) => void save(on)} label={t("Serve this vault over WebDAV", "이 볼트를 WebDAV로 열기")} hint={t("For Obsidian's Remotely Save plugin on phones and laptops.", "폰·노트북 Obsidian의 Remotely Save 플러그인용이에요.")} />
      {v.dav.enabled && (
        <>
          <Steps>
            {[
              <p key="1">{t("In Obsidian install Remotely Save and choose WebDAV.", "Obsidian에서 Remotely Save를 설치하고 WebDAV를 고르세요.")}</p>,
              <p key="2">{t("Address: your memexhub address + /dav/: any username.", "주소: memexhub 주소 + /dav/: 아이디는 아무거나.")}</p>,
              <p key="3">{t("Password: a device token that may use “Vault sync” (Devices).", "비밀번호: “볼트 동기화” 권한의 기기 토큰 (기기 화면).")}</p>,
            ]}
          </Steps>
          <Input label={t("Largest file (MB)", "가장 큰 파일 (MB)")} value={mb} onChange={setMb} inputMode="numeric" narrow />
        </>
      )}
    </Card>
  );
}

/** The search index behind note search: how many notes, how fresh, and a rebuild button. */
function SearchIndexLine({ s, reload }: { s: NonNullable<V["search"]>; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const text = !s.available
    ? t("Search index: not available here: search scans the notes.", "검색 색인: 이 환경에서는 못 써요: 검색할 때 노트를 훑어요.")
    : !s.ready
      ? t("Search index: building…", "검색 색인: 만드는 중…")
      : t(`Search index: ${s.notes} notes · updated ${ago(t, s.updated, tz)}`, `검색 색인: 노트 ${s.notes}개 · ${ago(t, s.updated, tz)} 갱신`);
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Status tone={s.available && s.ready ? "ok" : "idle"}>{text}</Status>
      {s.available && <Button kind="ghost" size="sm" busy={busy} onClick={() => run(() => post<{ notes: number }>("/vault/search-index/rebuild"), (r) => t(`Rebuilt: ${r.notes} notes.`, `다시 만들었어요: 노트 ${r.notes}개.`), reload)}>{t("Rebuild", "다시 만들기")}</Button>}
    </div>
  );
}

/** The change history beside the vault: on/off and how many changes are kept. */
function HistoryLine({ h, reload }: { h: V["history"]; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  return (
    <Toggle checked={h.on} disabled={busy} onChange={(on) => run(() => post("/vault/history/enabled", { on }), t("Saved.", "저장했어요."), reload)}
      label={t("Keep every change (history)", "모든 변경 기록 (이력)")}
      hint={h.on && h.available
        ? t(`${h.stats?.commits ?? 0} changes kept in git beside the vault. Earlier versions are under each note in Notes.`, `볼트 옆 git 에 변경 ${h.stats?.commits ?? 0}개를 보관 중이에요. 노트 화면에서 노트마다 이전 판을 볼 수 있어요.`)
        : h.on ? t("Not available for this vault (needs a vault on the server's disk and git).", "이 볼트에서는 못 써요 (서버 디스크의 볼트와 git 이 필요해요).")
          : t("Off. Overwritten notes are not kept.", "꺼져 있어요. 덮어쓴 노트는 남지 않아요.")} />
  );
}
