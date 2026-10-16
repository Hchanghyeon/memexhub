import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { post } from "../api";
import { useT } from "../i18n";
import { Link } from "../router";
import { Actions, Button, Callout, Card, DateInput, Empty, Item, List, Loading, Page, useAction, useData } from "../ui/kit";

interface Day {
  date: string;
  connected: boolean;
  tiles: { attribution: string } | null;
  km: number;
  path: [number, number, number][];
  stays: { start: number; end: number; minutes: number; lat: number; lon: number; name: string; named: boolean }[];
}

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const shift = (d: string, n: number) => new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10) + n)).toISOString().slice(0, 10);
const hhmm = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t * 1000));

/** One day of location on a map: the path and where you stayed. Admin-only — coordinates never leave this screen. */
export function MapPage() {
  const { t } = useT();
  const [date, setDate] = useState(today);
  const { data, error, reload } = useData<Day>(`/location/day?date=${date}`);
  const [focus, setFocus] = useState<number>();
  const dur = (m: number) => (m >= 60 ? t(`${Math.floor(m / 60)} h ${m % 60} min`, `${Math.floor(m / 60)}시간 ${m % 60}분`) : t(`${m} min`, `${m}분`));
  const day = data?.date === date ? data : undefined;
  return (
    <Page title={t("Map", "지도")} sub={t("Where you went on a day: the path and the places you stayed. Only you see this — Claude and the vault never get coordinates.", "하루 동안 다닌 길과 머문 곳이에요. 나만 볼 수 있어요 — Claude와 볼트에는 좌표가 가지 않아요.")}
      actions={
        <Actions>
          <Button kind="secondary" size="sm" onClick={() => setDate(shift(date, -1))} title={t("Previous day", "전날")}><ChevronLeft /></Button>
          <DateInput label={t("Date", "날짜")} value={date} max={today()} onChange={setDate} />
          <Button kind="secondary" size="sm" disabled={date >= today()} onClick={() => setDate(shift(date, 1))} title={t("Next day", "다음 날")}><ChevronRight /></Button>
          {date !== today() && <Button kind="ghost" size="sm" onClick={() => setDate(today())}>{t("Today", "오늘")}</Button>}
        </Actions>
      }>
      {!day ? <Loading error={error} reload={reload} /> : !day.connected ? (
        <Card><Callout tone="warning"><p>{t("No location source is connected yet.", "아직 위치 연결이 없어요.")} <Link to="/connections">{t("Connections", "연결")}</Link></p></Callout></Card>
      ) : (
        <>
          {!day.tiles && <TilesOff onDone={reload} />}
          <Card title={t("Route", "경로")} sub={day.path.length ? t(`${day.stays.length} stays · about ${day.km} km · ${hhmm(day.path[0]![2])}–${hhmm(day.path[day.path.length - 1]![2])}`, `머문 곳 ${day.stays.length}곳 · 이동 약 ${day.km}km · ${hhmm(day.path[0]![2])}–${hhmm(day.path[day.path.length - 1]![2])}`) : undefined}>
            {day.path.length ? <RouteMap day={day} focus={focus} /> : <Empty>{t("No location points on this day.", "이날은 위치 기록이 없어요.")}</Empty>}
          </Card>
          {day.stays.length > 0 && (
            <Card title={t("Where you stayed", "머문 곳")}>
              <List>
                {day.stays.map((s, i) => (
                  <Item key={s.start} icon={<span className="bg-primary text-primary-foreground flex size-6 items-center justify-center rounded-full text-xs font-semibold">{i + 1}</span>}
                    title={s.name || t("No name found", "이름 못 찾음")}
                    meta={`${hhmm(s.start)}–${hhmm(s.end)} · ${dur(s.minutes)}`}
                    actions={<Button kind="ghost" size="sm" onClick={() => setFocus(i)}>{t("Show", "지도에서 보기")}</Button>} />
                ))}
              </List>
            </Card>
          )}
        </>
      )}
    </Page>
  );
}

function TilesOff({ onDone }: { onDone: () => void }) {
  const { t } = useT();
  const { busy, run } = useAction();
  return (
    <Card>
      <Callout>
        <p>{t("The map background is off, so only the path is drawn. Turning it on lets this server fetch OpenStreetMap pictures for the area you look at and keep them for 30 days — your browser still only talks to memexhub.", "지도 바탕이 꺼져 있어서 길만 그려요. 켜면 이 서버가 보고 있는 지역의 OpenStreetMap 지도를 받아 30일 보관해요 — 브라우저는 그대로 memexhub에만 접속해요.")}</p>
      </Callout>
      <div><Button busy={busy} onClick={() => run(() => post("/connections", { provider: "maptiles:osm", name: "map", config: {}, secrets: {} }), t("Map background on.", "지도 바탕을 켰어요."), onDone)}>{t("Turn on the map background", "지도 바탕 켜기")}</Button></div>
    </Card>
  );
}

function RouteMap({ day, focus }: { day: Day; focus?: number }) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map>(undefined);
  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current, { zoomControl: true, attributionControl: true });
    map.current = m;
    if (day.tiles) L.tileLayer("/admin/api/map/tile/{z}/{x}/{y}", { maxZoom: 19, minZoom: 3, attribution: day.tiles.attribution }).addTo(m);
    const line = L.polyline(day.path.map(([a, b]) => [a, b] as [number, number]), { color: "#2563eb", weight: 4, opacity: 0.8 }).addTo(m);
    day.stays.forEach((s, i) =>
      L.circleMarker([s.lat, s.lon], { radius: 9, color: "#ffffff", weight: 2, fillColor: "#dc2626", fillOpacity: 1 })
        .bindTooltip(`${i + 1}. ${s.name || "?"}`, { direction: "top", offset: [0, -8] })
        .addTo(m),
    );
    const first = day.path[0]!;
    L.circleMarker([first[0], first[1]], { radius: 5, color: "#16a34a", fillColor: "#16a34a", fillOpacity: 1 }).bindTooltip("start").addTo(m);
    m.fitBounds(line.getBounds(), { padding: [24, 24], maxZoom: 16 });
    return () => {
      m.remove();
      map.current = undefined;
    };
  }, [day]);
  useEffect(() => {
    const s = focus === undefined ? undefined : day.stays[focus];
    if (s && map.current) {
      map.current.setView([s.lat, s.lon], 17);
      el.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [focus, day]);
  return <div ref={el} className="h-[60vh] min-h-80 w-full overflow-hidden rounded-lg border" role="region" aria-label="map" />;
}
