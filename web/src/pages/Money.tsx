import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useT } from "../i18n";
import { Link } from "../router";
import { Actions, Badge, Bars, Button, Callout, Card, Empty, Item, List, Loading, Meters, Page, Tile, Tiles, useData } from "../ui/kit";

interface M {
  month: string;
  total: number;
  count: number;
  before: { month: string; total: number; upToDay: number | null };
  days: { date: string; total: number; count: number }[];
  merchants: { name: string; total: number; count: number }[];
  cards: { name: string; total: number }[];
  recurring: { name: string; amount: string; date: string }[];
  largest: { date: string; name: string; amount: string }[];
  online: number;
  foreign: number;
}

const won = (n: number) => `₩${Math.round(n).toLocaleString("en-US")}`;
const thisMonth = () => new Date().toISOString().slice(0, 7);
const shift = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};

/** One month of payments: total against the month before, spending by day, where and with which card. */
export function MoneyPage() {
  const { t } = useT();
  const [month, setMonth] = useState(thisMonth);
  const { data, error, reload } = useData<M>(`/money?month=${month}`);
  const m = data?.month === month ? data : undefined;
  const label = (ym: string) => t(new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-US", { year: "numeric", month: "long" }), `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`);
  return (
    <Page title={t("Money", "돈")} sub={t("Card payments recorded from texts, notifications and receipt mails. Cancellations are subtracted.", "문자·알림·결제 메일로 기록된 카드 결제예요. 취소는 빼고 계산해요.")}
      actions={
        <Actions>
          <Button kind="secondary" size="sm" onClick={() => setMonth(shift(month, -1))} title={t("Previous month", "이전 달")}><ChevronLeft /></Button>
          <span className="min-w-24 text-center font-medium">{label(month)}</span>
          <Button kind="secondary" size="sm" disabled={month >= thisMonth()} onClick={() => setMonth(shift(month, 1))} title={t("Next month", "다음 달")}><ChevronRight /></Button>
          {month !== thisMonth() && <Button kind="ghost" size="sm" onClick={() => setMonth(thisMonth())}>{t("This month", "이번 달")}</Button>}
        </Actions>
      }>
      {error?.code === "ledger_off" ? (
        <Card><Callout tone="warning"><p>{t("Payments are turned off.", "결제 기능이 꺼져 있어요.")} <Link to="/features">{t("Turn it on in Features", "기능에서 켜기")}</Link></p></Callout></Card>
      ) : !m ? <Loading error={error} reload={reload} /> : !m.count && !m.before.total ? (
        <Card><Empty>{t("No payments this month.", "이번 달 결제가 없어요.")}</Empty></Card>
      ) : <Report m={m} />}
    </Page>
  );
}

function Report({ m }: { m: M }) {
  const { t } = useT();
  const diff = m.total - m.before.total;
  const vs = m.before.total
    ? (m.before.upToDay ? t(`vs ${m.before.month.slice(5)}/1–${m.before.upToDay}`, `지난달 같은 기간(1~${m.before.upToDay}일) 대비`) : t("vs last month", "지난달 대비")) + ` ${diff >= 0 ? "+" : "-"}${won(Math.abs(diff))}`
    : t("Nothing last month", "지난달 기록 없음");
  // "Large" only means something among many payments.
  const largest = m.count >= 6 ? m.largest.slice(0, 3) : [];
  const spentDays = m.days.filter((d) => d.total > 0).length;
  const maxM = Math.max(1, ...m.merchants.map((x) => x.total));
  const maxC = Math.max(1, ...m.cards.map((x) => x.total));
  const dayLabel = (d: string) => t(`${d.slice(5)}`, `${Number(d.slice(5, 7))}월 ${Number(d.slice(8))}일`);
  return (
    <>
      <Tiles>
        <Tile label={t("Spent", "쓴 돈")} value={won(m.total)} sub={vs} />
        <Tile label={t("Payments", "결제")} value={t(`${m.count}`, `${m.count}건`)} sub={t(`on ${spentDays} day(s)`, `${spentDays}일에 걸쳐`)} />
        <Tile label={t("Online", "온라인")} value={won(m.online)} sub={m.total > 0 ? t(`${Math.round((m.online / m.total) * 100)}% of the total`, `전체의 ${Math.round((m.online / m.total) * 100)}%`) : undefined} />
      </Tiles>
      <Card title={t("By day", "날짜별")} sub={t("Hover a bar for the day's total.", "막대에 마우스를 올리면 그날 합계가 보여요.")}>
        <Bars label={t("Spending by day", "날짜별 지출")} items={m.days.map((d, i) => ({ key: d.date, value: Math.max(0, d.total), tip: `${dayLabel(d.date)}: ${won(d.total)}${d.count ? t(` · ${d.count} payment(s)`, ` · ${d.count}건`) : ""}`, tick: i === 0 || (i + 1) % 5 === 0 ? String(i + 1) : undefined }))} />
      </Card>
      {m.merchants.length > 0 && (
        <Card title={t("Where", "어디서")} sub={t("Top 10 by amount.", "금액이 큰 10곳.")}>
          <Meters items={m.merchants.map((x) => ({ key: x.name, label: x.name, meta: t(`${x.count}×`, `${x.count}회`), value: won(x.total), share: x.total / maxM }))} />
        </Card>
      )}
      {m.cards.length > 1 && (
        <Card title={t("By card", "카드별")}>
          <Meters items={m.cards.map((x) => ({ key: x.name, label: x.name === "-" ? t("Unknown card", "카드 모름") : x.name, value: won(x.total), share: x.total / maxC }))} />
        </Card>
      )}
      {(m.recurring.length > 0 || largest.length > 0) && (
        <Card title={t("Worth a look", "눈여겨볼 것")}>
          <List>
            {m.recurring.map((x) => <Item key={`r${x.date}${x.name}`} title={x.name} badges={<Badge>{t("recurring", "정기 결제")}</Badge>} meta={t(`${x.date.slice(5)} · same amount about a month earlier`, `${dayLabel(x.date)} · 한 달쯤 전에도 같은 금액`)} actions={<span className="font-medium tabular-nums">{x.amount}</span>} />)}
            {largest.map((x) => <Item key={`l${x.date}${x.name}${x.amount}`} title={x.name} badges={<Badge>{t("large", "큰 결제")}</Badge>} meta={dayLabel(x.date)} actions={<span className="font-medium tabular-nums">{x.amount}</span>} />)}
          </List>
        </Card>
      )}
      {m.foreign > 0 && <Callout><p>{t(`${m.foreign} payment(s) in another currency are not in these totals.`, `다른 통화 결제 ${m.foreign}건은 합계에 넣지 않았어요.`)}</p></Callout>}
    </>
  );
}
