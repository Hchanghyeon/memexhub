import { useState } from "react";
import { download, post } from "../api";
import { useT, when } from "../i18n";
import { Actions, Badge, Button, Callout, Card, Fields, Input, Item, KeyValue, List, Loading, More, Page, Segmented, Status, Sub, TextArea, useAction, useConfirm, useData } from "../ui/kit";

type Guess = { merchant?: string; amount?: string; card?: string; time?: string; item?: string } | null;
interface R {
  dir: string;
  inbox: { id: string; receivedAt: string; channel: string; reason: string; from: string | null; subject: string | null; text: string; guess: Guess }[];
  proposed: { file: string; id: string; error: string | null }[];
  active: { id: string; name: string; kind: string; channels: string[]; path: string | null }[];
  errors: { id: string | null; path: string | null; error: string }[];
}
interface Read { step: string; recipeId?: string; confident: boolean; kind?: string; reason?: string; payment?: Record<string, string> }
const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function Recipes() {
  const { t } = useT();
  const { data, error, reload } = useData<R>("/recipes");
  const [editor, setEditor] = useState("");
  if (!data) return <Page title={t("Recipes & inbox", "레시피·대기함")}><Loading error={error} reload={reload} /></Page>;
  return (
    <Page title={t("Recipes & inbox", "레시피·대기함")} sub={t("Messages are read by recipes first, then by a general reader. What neither can read waits in the inbox for you or Claude.", "메시지는 레시피가 먼저, 그다음 공통 해석기가 읽어요. 둘 다 못 읽은 것은 대기함에서 나나 Claude를 기다려요.")}>
      <Inbox items={data.inbox} reload={reload} onDraft={setEditor} />
      <Try onDraft={setEditor} />
      <RecipeList r={data} reload={reload} />
      <Editor value={editor} setValue={setEditor} reload={reload} dir={data.dir} />
    </Page>
  );
}

function Inbox({ items, reload, onDraft }: { items: R["inbox"]; reload: () => void; onDraft: (j: string) => void }) {
  const { t } = useT();
  return (
    <Card title={t(`Inbox (${items.length})`, `대기함 (${items.length})`)} sub={items.length ? t("Record what is a payment, ignore the rest. Or ask Claude: “handle the payment inbox”.", "결제인 것은 기록하고 나머지는 버리세요. Claude에게 “결제 대기함 정리해 줘”라고 해도 돼요.") : undefined}>
      {items.length ? <List>{items.map((i) => <InboxItem key={i.id} i={i} reload={reload} onDraft={onDraft} />)}</List> : <Status tone="ok">{t("Nothing waiting.", "기다리는 메시지가 없어요.")}</Status>}
    </Card>
  );
}

function InboxItem({ i, reload, onDraft }: { i: R["inbox"][number]; reload: () => void; onDraft: (j: string) => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ merchant: i.guess?.merchant ?? "", amount: i.guess?.amount ?? "", card: i.guess?.card ?? "", time: i.guess?.time ?? "" });
  const record = () => run(() => post(`/inbox/${i.id}`, { action: "record", ...f }), t("Recorded.", "기록했어요."), reload);
  return (
    <Item tone="warn" title={i.subject ?? i.text.slice(0, 60)}
      meta={<>{when(i.receivedAt, tz)} · {i.channel}{i.from ? ` · ${i.from}` : ""}{i.guess?.amount ? <> · {t("Guess", "추측")}: {i.guess.merchant} {i.guess.amount}</> : null}</>}
      actions={!open && <>
        <Button size="sm" onClick={() => setOpen(true)}>{t("Record", "기록")}</Button>
        <Button size="sm" kind="secondary" disabled={busy} onClick={() => run(() => post(`/inbox/${i.id}`, { action: "ignore" }), t("Ignored.", "버렸어요."), reload)}>{t("Ignore", "버리기")}</Button>
      </>}>
      {open && (
        <>
          <pre className="bg-muted max-h-48 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">{i.text}</pre>
          <Fields>
            <Input label={t("Merchant", "가맹점")} value={f.merchant} onChange={(v) => setF({ ...f, merchant: v })} />
            <Input label={t("Amount", "금액")} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} placeholder="₩12,500" />
            <Input label={t("Card", "카드")} value={f.card} onChange={(v) => setF({ ...f, card: v })} />
            <Input label={t("Time", "시각")} value={f.time} onChange={(v) => setF({ ...f, time: v })} placeholder="2026-10-14T12:30:00+09:00" mono />
          </Fields>
          <Actions>
            <Button size="sm" busy={busy} onClick={() => void record()}>{t("Record with these values", "이 값으로 기록")}</Button>
            <Button size="sm" kind="secondary" disabled={busy} onClick={() => run(() => post(`/inbox/${i.id}`, { action: "ignore" }), t("Ignored.", "버렸어요."), reload)}>{t("Ignore", "버리기")}</Button>
            <Button size="sm" kind="ghost" onClick={() => run(() => post<{ json: string }>("/recipes/draft-from", { id: i.id }), t("Draft ready below.", "아래에 초안을 만들었어요."), (r) => { onDraft(r.json); document.getElementById("editor")?.scrollIntoView({ behavior: "smooth" }); })}>{t("Make a recipe from it", "이걸로 레시피 만들기")}</Button>
          </Actions>
        </>
      )}
    </Item>
  );
}

function Try({ onDraft }: { onDraft: (j: string) => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("sms");
  const [r, setR] = useState<Read>();
  return (
    <Card title={t("Try a message", "메시지 시험")} sub={t("Paste a card message or receipt to see how it would be read. Nothing is recorded.", "카드 문자나 영수증을 붙여 넣어 어떻게 읽히는지 보세요. 기록되지는 않아요.")}
      footer={<>
        <Button busy={busy} disabled={!text.trim()} onClick={() => run(() => post<Read>("/recipes/try", { channel, text }), undefined, setR)}>{t("Try", "시험")}</Button>
        <Button kind="secondary" disabled={busy || !text.trim()} onClick={() => run(() => post<{ json: string }>("/recipes/draft", { channel, text }), t("Draft ready below.", "아래에 초안을 만들었어요."), (x) => onDraft(x.json))}>{t("Make a recipe from it", "이걸로 레시피 만들기")}</Button>
      </>}>
      <Segmented value={channel} onChange={setChannel} options={["sms", "mail", "notification", "text"].map((c) => ({ value: c, label: c }))} />
      <TextArea label={t("Message", "메시지")} value={text} onChange={setText} rows={5} />
      {r && (
        <Callout tone={r.confident || r.kind === "ignore" ? "info" : "warning"}>
          <p className="font-medium">{r.kind === "ignore" ? t(`Ignored by recipe ${r.recipeId}.`, `레시피 ${r.recipeId}가 무시해요.`) : r.confident ? t(`Would be recorded — ${r.step === "recipe" ? `recipe ${r.recipeId}` : "general reader"}.`, `기록돼요 — ${r.step === "recipe" ? `레시피 ${r.recipeId}` : "공통 해석기"}.`) : t(`Would wait in the inbox — ${r.reason ?? ""}.`, `대기함으로 가요 — ${r.reason ?? ""}.`)}</p>
          {r.payment && <KeyValue rows={Object.entries(r.payment).filter(([, v]) => v).map(([k, v]) => [k, v])} />}
        </Callout>
      )}
    </Card>
  );
}

function RecipeList({ r, reload }: { r: R; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const confirm = useConfirm();
  return (
    <Card title={t("Recipes", "레시피")} sub={<>{t("Rules for one sender each, kept as notes in", "보내는 곳마다 하나씩인 규칙이에요. 노트로 저장돼요:")} <code>{r.dir}/</code></>} aside={<Button kind="secondary" size="sm" onClick={() => void download("/recipes/export", "memexhub-recipes.json")}>{t("Export", "내보내기")}</Button>}>
      {r.proposed.length > 0 && (
        <>
          <Sub>{t("Waiting for your approval", "승인 대기")}</Sub>
          <List>
            {r.proposed.map((p) => (
              <Item key={p.file} tone={p.error ? "err" : "ok"} title={p.id} meta={p.error ? <span className="text-destructive">{p.error}</span> : t("examples pass", "예시 통과")}
                actions={!p.error && <Button size="sm" busy={busy} onClick={() => run(() => post<{ message: string }>("/recipes/approve", { file: p.file }), (x) => x.message, reload)}>{t("Approve", "승인")}</Button>} />
            ))}
          </List>
        </>
      )}
      <Sub>{t(`In use (${r.active.length})`, `사용 중 (${r.active.length})`)}</Sub>
      <List>
        {r.active.map((a) => (
          <Item key={a.id} tone="ok" title={a.name} badges={<><Badge>{a.channels.join(", ")}</Badge>{!a.path && <Badge tone="basic">{t("built-in", "기본")}</Badge>}</>}
            meta={<><code>{a.id}</code> · {a.kind}</>}
            actions={<Button size="sm" kind="ghost" disabled={busy} onClick={() => confirm(t(`Turn off ${a.id}?`, `${a.id}를 끌까요?`)) && run(() => post<{ message: string }>("/recipes/disable", { id: a.id }), (x) => x.message, reload)}>{t("Turn off", "끄기")}</Button>} />
        ))}
      </List>
      {r.errors.length > 0 && (
        <>
          <Sub>{t("Not used (broken)", "쓰지 않음 (오류)")}</Sub>
          <List>{r.errors.map((e, i) => <Item key={i} tone="err" title={e.path ?? e.id ?? "?"} meta={<span className="text-destructive">{e.error}</span>} />)}</List>
        </>
      )}
    </Card>
  );
}

function Editor({ value, setValue, reload, dir }: { value: string; setValue: (v: string) => void; reload: () => void; dir: string }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [pack, setPack] = useState("");
  return (
    <Card id="editor" title={t("New recipe", "새 레시피")} badge={<Badge>{t("Advanced", "고급")}</Badge>} sub={t(`Saved as a proposal in ${dir}/proposed/; approve it above. If you share it, change names and numbers in the example to fake ones.`, `${dir}/proposed/에 제안으로 저장돼요. 위에서 승인하세요. 공유할 때는 예시의 이름과 숫자를 가짜로 바꾸세요.`)}
      footer={<Button busy={busy} disabled={!value.trim()} onClick={() => run(() => post<{ message: string }>("/recipes/save", { json: value }), (x) => x.message, () => { setValue(""); reload(); })}>{t("Save as proposal", "제안으로 저장")}</Button>}>
      <TextArea label={t("Recipe (JSON)", "레시피 (JSON)")} value={value} onChange={setValue} rows={12} mono />
      <More summary={t("Import a recipe pack", "레시피 묶음 가져오기")}>
        <TextArea label={t("JSON array", "JSON 배열")} value={pack} onChange={setPack} rows={4} mono />
        <Actions><Button kind="secondary" busy={busy} disabled={!pack.trim()} onClick={() => run(() => post<{ message: string }>("/recipes/import", { json: pack }), (x) => x.message, () => { setPack(""); reload(); })}>{t("Import as proposals", "제안으로 가져오기")}</Button></Actions>
      </More>
    </Card>
  );
}
