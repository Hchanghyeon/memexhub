import { useState } from "react";
import { download, post } from "../api";
import { useT, when } from "../i18n";
import { Actions, Badge, Button, Callout, Card, Check, Fields, Hint, Input, Item, KeyValue, List, Loading, More, Page, Segmented, Status, Sub, TextArea, useAction, useConfirm, useData } from "../ui/kit";

/*
 * Payment messages: card texts, receipt mails and notifications become payments.
 * Words on this screen are about what the owner does, not how the engine works:
 * "recipes" are shown as "read by itself" senders, the inbox as "please check".
 */
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
const CHANNEL: Record<string, [string, string]> = { sms: ["Text", "문자"], mail: ["Mail", "메일"], notification: ["Notification", "알림"], text: ["Pasted", "붙여 넣은 글"] };

export function Recipes() {
  const { t } = useT();
  const { data, error, reload } = useData<R>("/recipes");
  const [editor, setEditor] = useState("");
  const title = t("Payment messages", "결제 메시지");
  if (!data) return <Page title={title}><Loading error={error} reload={reload} /></Page>;
  return (
    <Page title={title} sub={t("Card texts, receipt mails and notifications become payment records. Most are read by themselves; you are asked only when memexhub is not sure.", "카드 문자, 결제 메일, 알림을 결제 기록으로 바꿔요. 대부분 알아서 읽고, 확신이 없을 때만 여기서 물어봐요.")}>
      <ToCheck items={data.inbox} reload={reload} />
      <Senders r={data} reload={reload} />
      <Advanced editor={editor} setEditor={setEditor} dir={data.dir} reload={reload} />
    </Page>
  );
}

/** Messages memexhub could not read with confidence (the inbox). */
function ToCheck({ items, reload }: { items: R["inbox"]; reload: () => void }) {
  const { t } = useT();
  return (
    <Card title={items.length ? t(`Please check (${items.length})`, `확인해 주세요 (${items.length})`) : t("Please check", "확인해 주세요")}
      sub={items.length ? t("memexhub was not sure these are payments, or how much. Say yes or no. You can also ask Claude: “check my payment messages”.", "결제인지, 얼마인지 확신하지 못한 메시지예요. 맞는지 아닌지만 알려 주세요. Claude에게 “결제 메시지 확인해 줘”라고 맡겨도 돼요.") : undefined}>
      {items.length ? <List>{items.map((i) => <Waiting key={i.id} i={i} reload={reload} />)}</List> : <Status tone="ok">{t("All read. Nothing to check.", "모두 읽었어요. 확인할 메시지가 없어요.")}</Status>}
    </Card>
  );
}

function Waiting({ i, reload }: { i: R["inbox"][number]; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [learn, setLearn] = useState(true);
  // The reader writes a placeholder when it found no merchant: treat it as unknown here.
  const merchant = i.guess?.merchant && i.guess.merchant !== "가맹점 없음" ? i.guess.merchant : "";
  const [f, setF] = useState({ merchant, amount: i.guess?.amount ?? "", card: i.guess?.card ?? "", time: i.guess?.time ?? "" });
  const ch = CHANNEL[i.channel] ?? [i.channel, i.channel];
  const notPayment = () => run(() => post(`/inbox/${i.id}`, { action: "ignore" }), t("Marked as not a payment.", "결제가 아닌 걸로 했어요."), reload);
  const record = () =>
    learn
      ? run(() => post<{ learned: boolean; name?: string; reason?: string }>(`/inbox/${i.id}/learn`, f), (r) => (r.learned ? t(`Recorded. Messages from “${r.name}” are now read by themselves.`, `기록했어요. 이제 “${r.name}” 메시지는 알아서 읽어요.`) : t(`Recorded. Could not learn this sender (${r.reason ?? ""}): Claude can try.`, `기록했어요. 이곳을 알아서 읽는 법은 못 만들었어요 (${r.reason ?? ""}). Claude에게 맡겨 보세요.`)), reload)
      : run(() => post(`/inbox/${i.id}`, { action: "record", ...f }), t("Recorded.", "기록했어요."), reload);
  return (
    <Item tone="warn" title={i.subject ?? i.text.replace(/\[Web발신\]/g, "").trim().split("\n").slice(0, 2).join(" · ").slice(0, 80)}
      meta={<>{when(i.receivedAt, tz)} · {t(...ch)}{i.from ? ` · ${i.from}` : ""}{i.guess?.amount ? <> · {t("Looks like", "추측")}: {[merchant, i.guess.amount].filter(Boolean).join(" ")}</> : null}</>}
      actions={!open && <>
        <Button size="sm" onClick={() => setOpen(true)}>{t("It's a payment", "결제 맞아요")}</Button>
        <Button size="sm" kind="secondary" disabled={busy} onClick={() => void notPayment()}>{t("Not a payment", "결제 아니에요")}</Button>
      </>}>
      {open && (
        <>
          <pre className="bg-muted max-h-48 overflow-auto rounded-lg p-3 font-mono text-xs whitespace-pre-wrap">{i.text}</pre>
          <Fields>
            <Input label={t("Where", "어디서")} value={f.merchant} onChange={(v) => setF({ ...f, merchant: v })} />
            <Input label={t("How much", "얼마")} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} placeholder="₩12,500" hint={t("A cancellation is negative: -₩8,000", "취소는 마이너스: -₩8,000")} />
            <Input label={t("Card", "카드")} value={f.card} onChange={(v) => setF({ ...f, card: v })} />
            <Input label={t("When", "언제")} value={f.time} onChange={(v) => setF({ ...f, time: v })} placeholder="2026-10-14T12:30:00+09:00" hint={t("Empty: when the message arrived", "비우면 메시지가 온 시각")} mono />
          </Fields>
          <Check checked={learn} onChange={setLearn} label={t("Read messages like this by themselves from now on", "다음부터 이런 메시지는 알아서 읽기")} hint={t("memexhub learns this sender from this message and your answer.", "이 메시지와 지금 고른 값으로 이곳을 읽는 법을 배워요.")} />
          <Actions>
            <Button size="sm" busy={busy} onClick={() => void record()}>{t("Record", "기록하기")}</Button>
            <Button size="sm" kind="ghost" disabled={busy} onClick={() => setOpen(false)}>{t("Cancel", "취소")}</Button>
          </Actions>
        </>
      )}
    </Item>
  );
}

/** Senders memexhub reads by itself (recipes), and the ones Claude proposed. */
function Senders({ r, reload }: { r: R; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const confirm = useConfirm();
  const used = r.active.filter((a) => a.kind !== "ignore");
  return (
    <Card title={t(`Read by themselves (${used.length})`, `알아서 읽는 곳 (${used.length})`)}
      sub={t("Messages from these senders are recorded without asking. Most other payment messages are read too, by the general reader.", "여기 있는 곳(카드사·결제 서비스)의 메시지는 묻지 않고 기록해요. 그 밖의 결제 메시지도 대부분 기본 읽기로 읽혀요.")}>
      {r.proposed.length > 0 && (
        <>
          <Sub>{t("Proposed by Claude: turn on if it looks right", "Claude가 제안한 것: 맞으면 켜세요")}</Sub>
          <List>
            {r.proposed.map((p) => (
              <Item key={p.file} tone={p.error ? "err" : "ok"} title={p.id} meta={p.error ? <span className="text-destructive">{p.error}</span> : t("Reads its own example correctly.", "예시를 제대로 읽어요.")}
                actions={!p.error && <Button size="sm" busy={busy} onClick={() => run(() => post("/recipes/approve", { file: p.file }), t("Turned on.", "켰어요."), reload)}>{t("Turn on", "켜기")}</Button>} />
            ))}
          </List>
          <Sub>{t("In use", "쓰는 중")}</Sub>
        </>
      )}
      <List>
        {used.map((a) => (
          <Item key={a.id} tone="ok" title={a.name} badges={<>{a.channels.map((c) => <Badge key={c}>{t(...(CHANNEL[c] ?? [c, c]))}</Badge>)}{!a.path && <Badge tone="basic">{t("built-in", "기본")}</Badge>}</>}
            actions={<Button size="sm" kind="ghost" disabled={busy} onClick={() => confirm(t(`Stop reading “${a.name}” by itself? Its messages will be asked about.`, `“${a.name}”을 알아서 읽지 않을까요? 이곳 메시지는 앞으로 물어봐요.`)) && run(() => post("/recipes/disable", { id: a.id }), t("Turned off.", "껐어요."), reload)}>{t("Turn off", "끄기")}</Button>} />
        ))}
      </List>
      {r.errors.length > 0 && (
        <Callout tone="warning">
          <p>{t("These could not be used and are skipped:", "아래는 오류가 있어서 쓰지 않아요:")}</p>
          <ul className="list-disc pl-5">{r.errors.map((e, i) => <li key={i}><code>{e.path ?? e.id ?? "?"}</code>: {e.error}</li>)}</ul>
        </Callout>
      )}
    </Card>
  );
}

/** Trying a message and writing a recipe by hand: for people who want to see the rules. */
function Advanced({ editor, setEditor, dir, reload }: { editor: string; setEditor: (v: string) => void; dir: string; reload: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  const [text, setText] = useState("");
  const [channel, setChannel] = useState("sms");
  const [r, setR] = useState<Read>();
  const [pack, setPack] = useState("");
  return (
    <Card id="editor" title={t("Advanced", "고급")} sub={<>{t("Each sender's rule is a “recipe”: a small note in", "곳마다 읽는 법은 “레시피”라는 작은 노트로 저장돼요:")} <code>{dir}/</code></>}
      aside={<Button kind="secondary" size="sm" onClick={() => void download("/recipes/export", "memexhub-recipes.json")}>{t("Export", "내보내기")}</Button>}>
      <More summary={t("Try a message", "메시지로 시험해 보기")}>
        <Hint>{t("Paste a card text or receipt to see how it would be read. Nothing is recorded.", "카드 문자나 영수증을 붙여 넣어 어떻게 읽히는지 봐요. 기록되지는 않아요.")}</Hint>
        <Segmented value={channel} onChange={setChannel} options={Object.entries(CHANNEL).map(([value, l]) => ({ value, label: t(...l) }))} />
        <TextArea label={t("Message", "메시지")} value={text} onChange={setText} rows={5} />
        <Actions>
          <Button size="sm" busy={busy} disabled={!text.trim()} onClick={() => run(() => post<Read>("/recipes/try", { channel, text }), undefined, setR)}>{t("Try", "시험")}</Button>
          <Button size="sm" kind="secondary" disabled={busy || !text.trim()} onClick={() => run(() => post<{ json: string }>("/recipes/draft", { channel, text }), t("Draft ready below.", "아래에 초안을 만들었어요."), (x) => setEditor(x.json))}>{t("Draft a recipe from it", "이걸로 레시피 초안 만들기")}</Button>
        </Actions>
        {r && (
          <Callout tone={r.confident || r.kind === "ignore" ? "info" : "warning"}>
            <p className="font-medium">{r.kind === "ignore" ? t("Skipped: not a payment.", "건너뛰어요: 결제가 아니에요.") : r.confident ? t(`Recorded by itself (${r.step === "recipe" ? r.recipeId : "general reader"}).`, `알아서 기록돼요 (${r.step === "recipe" ? r.recipeId : "기본 읽기"}).`) : t(`You would be asked: ${r.reason ?? ""}.`, `확인해 달라고 물어봐요: ${r.reason ?? ""}.`)}</p>
            {r.payment && <KeyValue rows={Object.entries(r.payment).filter(([, v]) => v).map(([k, v]) => [k, v])} />}
          </Callout>
        )}
      </More>
      <More summary={t("Write a recipe (JSON)", "레시피 직접 쓰기 (JSON)")}>
        <Hint>{t("Saved as a proposal; turn it on above. If you share it, change names and numbers in the example to fake ones. Format: docs/recipes.md", "제안으로 저장되고, 위에서 켜면 쓰여요. 공유할 때는 예시의 이름과 숫자를 가짜로 바꾸세요. 형식: docs/recipes.md")}</Hint>
        <TextArea label={t("Recipe (JSON)", "레시피 (JSON)")} value={editor} onChange={setEditor} rows={12} mono />
        <Actions><Button size="sm" busy={busy} disabled={!editor.trim()} onClick={() => run(() => post("/recipes/save", { json: editor }), t("Saved as a proposal.", "제안으로 저장했어요."), () => { setEditor(""); reload(); })}>{t("Save as proposal", "제안으로 저장")}</Button></Actions>
      </More>
      <More summary={t("Import recipes", "레시피 가져오기")}>
        <TextArea label={t("JSON array", "JSON 배열")} value={pack} onChange={setPack} rows={4} mono />
        <Actions><Button size="sm" kind="secondary" busy={busy} disabled={!pack.trim()} onClick={() => run(() => post<{ message: string }>("/recipes/import", { json: pack }), (x) => x.message, () => { setPack(""); reload(); })}>{t("Import as proposals", "제안으로 가져오기")}</Button></Actions>
      </More>
    </Card>
  );
}
