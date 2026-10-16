import { useRef, useState } from "react";
import { download, post, upload } from "../api";
import { useT, when } from "../i18n";
import { Actions, Badge, Button, Card, Empty, Field, Hint, Input, Item, List, Loading, More, Muted, Page, useAction, useConfirm, useData } from "../ui/kit";

interface B { available: boolean; list: { name: string; size: number; created: string }[] }

function FileForm(p: { path: string; label: string; button: string; accept: string; ok: (r: any) => string; extra?: (fd: FormData) => void; danger?: boolean; confirm?: string; children?: React.ReactNode; onDone?: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const confirm = useConfirm();
  return (
    <form className="flex flex-col gap-5" onSubmit={(e) => {
      e.preventDefault();
      const f = ref.current?.files?.[0];
      if (!f || (p.confirm && !confirm(p.confirm))) return;
      const fd = new FormData();
      fd.append("file", f);
      p.extra?.(fd);
      void run(() => upload(p.path, fd), p.ok, p.onDone);
    }}>
      <Field label={p.label}>
        {(id) => <input id={id} ref={ref} type="file" accept={p.accept} required className="text-muted-foreground file:border-input file:bg-background file:text-foreground hover:file:bg-accent block w-full text-sm file:mr-3 file:h-9 file:cursor-pointer file:rounded-md file:border file:px-3 file:text-sm file:font-medium" />}
      </Field>
      {p.children}
      <Actions><Button type="submit" kind={p.danger ? "danger" : "secondary"} busy={busy}>{p.button}</Button></Actions>
    </form>
  );
}

export function Backups() {
  const { t } = useT();
  const { data, error, reload } = useData<B>("/backups");
  const { busy, run } = useAction();
  const [confirmText, setConfirmText] = useState("");
  const [tok, setTok] = useState({ name: "", token: "", scopes: "ledger,health" });
  if (!data) return <Page title={t("Backups", "백업")}><Loading error={error} reload={reload} /></Page>;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (
    <Page title={t("Backups", "백업")} sub={t("Settings, connections (secrets stay encrypted), tokens, records and logs — encrypted with your MEMEXHUB_SECRET. Vault notes are not included; your sync or storage keeps them.", "설정, 연결(비밀값은 암호화된 채), 토큰, 기록, 로그가 MEMEXHUB_SECRET으로 암호화돼 들어가요. 볼트 노트는 들어가지 않아요. 노트는 동기화나 저장소가 지켜요.")}>
      <Card title={t("Download a backup", "백업 내려받기")} badge={<Badge tone="recommended">{t("Recommended", "추천")}</Badge>} sub={t("Keep one somewhere other than this server now and then.", "가끔 하나씩 이 서버가 아닌 곳에 보관하세요.")}
        footer={<Button busy={busy} onClick={() => void run(() => download("/backups/download", "memexhub.mxb"), t("Downloaded.", "내려받았어요."))}>{t("Download now", "지금 내려받기")}</Button>} />
      <Card title={t("Automatic daily copies", "매일 자동 백업")}>
        {!data.available ? <Muted>{t("Not available here — download backups instead.", "이 환경에서는 안 돼요. 내려받기를 쓰세요.")}</Muted> : data.list.length ? (
          <List>{data.list.map((b) => <Item key={b.name} tone="ok" title={when(b.created, tz)} meta={b.name} actions={<span className="text-muted-foreground text-[0.8125rem]">{Math.ceil(b.size / 1024)} KB</span>} />)}</List>
        ) : <Empty>{t("The first copy is made within an hour. The newest 14 are kept.", "첫 백업은 한 시간 안에 만들어지고 최근 14개를 남겨요.")}</Empty>}
      </Card>
      <Card title={t("Restore", "복원")} sub={t("Replaces all settings, connections, tokens and records with the backup's. Cannot be undone.", "모든 설정, 연결, 토큰, 기록을 백업 내용으로 바꿔요. 되돌릴 수 없어요.")}>
        <More summary={t("Restore from a file", "파일에서 복원")}>
          <FileForm path="/backups/restore" label={t("Backup file (.mxb)", "백업 파일 (.mxb)")} accept=".mxb" button={t("Restore", "복원")} danger ok={(r) => t(`Restored ${r.rows} rows.`, `${r.rows}행을 복원했어요.`)} extra={(fd) => fd.append("confirm", confirmText)} onDone={() => location.reload()}>
            <Input label={t("Type RESTORE to confirm", "확인하려면 RESTORE 입력")} value={confirmText} onChange={setConfirmText} narrow />
          </FileForm>
        </More>
      </Card>
      <Card title={t("Move from a previous setup", "예전 설정에서 옮기기")} badge={<Badge>{t("Optional", "선택")}</Badge>} sub={t("Importing the same file twice adds nothing.", "같은 파일을 두 번 가져와도 늘어나지 않아요.")}>
        <More summary={t("Payments (JSON Lines)", "결제 (JSON Lines)")}>
          <FileForm path="/import/ledger" label={t("One record per line with time, merchant, amount, card", "한 줄에 기록 하나 (time, merchant, amount, card)")} accept=".jsonl,.json,.txt" button={t("Import payments", "결제 가져오기")} ok={(r) => t(`Added ${r.added}, skipped ${r.skipped}.`, `${r.added}건 추가, ${r.skipped}건은 이미 있음.`)} />
        </More>
        <More summary={t("Health (JSON)", "건강 (JSON)")}>
          <FileForm path="/import/health" label="JSON" accept=".json" button={t("Import health", "건강 가져오기")} ok={(r) => t(`Imported ${r.added} days.`, `${r.added}일을 가져왔어요.`)} />
        </More>
        <More summary={t("Keep an existing device token", "쓰던 기기 토큰 유지")}>
          <Hint>{t("Your automations keep their token and only change the address.", "자동화는 토큰을 그대로 두고 주소만 바꾸면 돼요.")}</Hint>
          <Input label={t("Name", "이름")} value={tok.name} onChange={(v) => setTok({ ...tok, name: v })} />
          <Input label={t("Existing token (24+ characters)", "쓰던 토큰 (24자 이상)")} type="password" value={tok.token} onChange={(v) => setTok({ ...tok, token: v })} autoComplete="off" />
          <Input label={t("Scopes (comma separated)", "권한 (쉼표로 구분)")} value={tok.scopes} onChange={(v) => setTok({ ...tok, scopes: v })} mono />
          <Actions><Button kind="secondary" busy={busy} onClick={() => void run(() => post("/import/token", { ...tok, scopes: tok.scopes.split(",").map((s) => s.trim()).filter(Boolean) }), t("Token kept.", "토큰을 유지했어요."), () => setTok({ name: "", token: "", scopes: "ledger,health" }))}>{t("Keep this token", "이 토큰 유지")}</Button></Actions>
        </More>
      </Card>
    </Page>
  );
}
