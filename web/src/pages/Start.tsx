import { useState } from "react";
import { post } from "../api";
import { useT } from "../i18n";
import { navigate } from "../router";
import { Button, Card, Copy, Input, Loading, Page, Segmented, Select, useAction, useData } from "../ui/kit";

interface S { timezone: string; zones: string[]; notes: "en" | "ko"; tools: "en" | "ko" | "both"; vault: boolean; runtime: string; preset: string | null; presets: string[]; mcpUrl: string }

/** First-run setup: four short steps, each skippable, recommended choice first. */
export function Start({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { data, error, reload } = useData<S>("/start");
  const { busy, run } = useAction();
  const [step, setStep] = useState(1);
  const [basics, setBasics] = useState<{ timezone: string; notes: "en" | "ko"; tools: "en" | "ko" | "both" }>();
  const [vault, setVault] = useState({ provider: "", path: "" });
  const [preset, setPreset] = useState("");
  if (!data) return <Page title={t("Set up", "처음 설정")}><Loading error={error} reload={reload} /></Page>;
  const b = basics ?? { timezone: data.timezone === "UTC" ? Intl.DateTimeFormat().resolvedOptions().timeZone : data.timezone, notes: data.notes, tools: data.tools };
  const STEPS = [t("Language & time", "언어·시간"), t("Vault", "볼트"), t("Layout", "구조"), t("Claude app", "Claude 앱")];
  const next = () => setStep((s) => s + 1);
  const finish = () => run(() => post("/start/done"), t("All set.", "설정을 마쳤어요."), () => { onDone(); navigate("/", true); });
  return (
    <Page title={t("Welcome to memexhub", "memexhub에 오신 걸 환영해요")} sub={t(`Step ${step} of 4 · ${STEPS[step - 1]}`, `4단계 중 ${step}단계 · ${STEPS[step - 1]}`)}>
      <div className="progress"><span style={{ width: `${(step / 4) * 100}%` }} /></div>
      {step === 1 && (
        <Card title={STEPS[0]}>
          <Select label={t("Time zone", "시간대")} hint={t("Dates in notes use it.", "노트의 날짜에 써요.")} value={b.timezone} onChange={(v) => setBasics({ ...b, timezone: v })} options={data.zones.map((z) => ({ value: z, label: z }))} />
          <div className="field"><label>{t("Language of notes memexhub writes", "memexhub가 쓰는 노트 언어")}</label><Segmented value={b.notes} onChange={(v) => setBasics({ ...b, notes: v })} options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }]} /></div>
          <div className="field"><label>{t("Language Claude sees", "Claude가 보는 언어")}</label><Segmented value={b.tools} onChange={(v) => setBasics({ ...b, tools: v })} options={[{ value: "ko", label: "한국어" }, { value: "en", label: "English" }, { value: "both", label: t("Both", "둘 다") }]} /></div>
          <Button busy={busy} onClick={() => run(() => post("/start/basics", b), undefined, next)}>{t("Next", "다음")}</Button>
        </Card>
      )}
      {step === 2 && (
        <Card title={STEPS[1]} sub={data.vault ? t("A vault is already connected. You can keep it.", "볼트가 이미 연결돼 있어요. 그대로 써도 돼요.") : t("Where should your notes live?", "노트를 어디에 둘까요?")}>
          {data.vault ? (
            <div className="actions"><Button onClick={next}>{t("Keep it and continue", "그대로 두고 계속")}</Button></div>
          ) : (
            <>
              {data.runtime === "workers" ? (
                <label className="check"><input type="radio" checked readOnly /><span><b>{t("This Worker's R2 bucket", "이 Worker의 R2 버킷")}</b> {t("(recommended)", "(추천)")}</span></label>
              ) : (
                <>
                  <label className="check"><input type="radio" name="v" checked={vault.provider !== "folder"} onChange={() => setVault({ ...vault, provider: "builtin" })} /><span><b>{t("A new folder on this server", "이 서버에 새 폴더")}</b> {t("(recommended) — you can sync it to Obsidian later", "(추천) — 나중에 Obsidian과 동기화할 수 있어요")}</span></label>
                  <label className="check"><input type="radio" name="v" checked={vault.provider === "folder"} onChange={() => setVault({ ...vault, provider: "folder" })} /><span>{t("A folder that already exists (an Obsidian vault)", "이미 있는 폴더 (Obsidian 볼트)")}</span></label>
                  {vault.provider === "folder" && <Input label={t("Folder path", "폴더 경로")} value={vault.path} onChange={(v) => setVault({ ...vault, path: v })} mono />}
                </>
              )}
              <div className="actions">
                <Button busy={busy} onClick={() => run(() => post("/vault", { provider: data.runtime === "workers" ? "r2" : vault.provider || "builtin", path: vault.path }), t("Vault connected.", "볼트를 연결했어요."), next)}>{t("Connect and continue", "연결하고 계속")}</Button>
                <Button kind="ghost" onClick={next}>{t("Skip", "건너뛰기")}</Button>
              </div>
              <p className="hint">{t("WebDAV and Notion are under Vault later.", "WebDAV나 Notion은 나중에 볼트 화면에서 고를 수 있어요.")}</p>
            </>
          )}
        </Card>
      )}
      {step === 3 && (
        <Card title={STEPS[2]} sub={t("Pick the layout closest to yours. You can change every folder later.", "가장 비슷한 구조를 고르세요. 폴더는 나중에 다 바꿀 수 있어요.")}>
          {data.presets.map((p) => (
            <label key={p} className="check"><input type="radio" name="p" checked={(preset || data.preset || "llm-wiki") === p} onChange={() => setPreset(p)} /><b>{p}</b></label>
          ))}
          <div className="actions">
            <Button busy={busy} onClick={() => run(() => post("/wiki/preset", { preset: preset || data.preset || "llm-wiki" }), undefined, next)}>{t("Use this layout", "이 구조 쓰기")}</Button>
            <Button kind="ghost" onClick={next}>{t("Skip", "건너뛰기")}</Button>
          </div>
        </Card>
      )}
      {step === 4 && (
        <Card title={STEPS[3]}>
          <ol className="steps">
            <li>{t("Claude app or claude.ai → Settings → Connectors → Add custom connector.", "Claude 앱이나 claude.ai → 설정 → 커넥터 → 사용자 지정 커넥터 추가.")}</li>
            <li>{t("Paste this address:", "이 주소를 붙여 넣으세요:")}<Copy text={data.mcpUrl} /></li>
            <li>{t("Sign in with the account you just made and press Allow.", "방금 만든 계정으로 로그인하고 허용을 누르세요.")}</li>
          </ol>
          <Button busy={busy} onClick={() => void finish()}>{t("Finish", "마치기")}</Button>
        </Card>
      )}
    </Page>
  );
}
