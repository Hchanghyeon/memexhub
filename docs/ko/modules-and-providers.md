# 모듈과 공급자

- **모듈** = 무엇을 하나 (도메인 로직, 도구, 노트)
- **공급자** = 어디서 가져오나 (바깥 서비스)

모듈은 공급자 **인터페이스**만 알아요. 공급자는 관리 화면에서 고르고, 여러 개를 같이 켤 수 있어요 (메일 계정 여러 개).

## 모듈 약속

```ts
export interface ModuleDef {
  id: string;
  title: Text;                 // { en, ko }
  needs?: ("vault")[];
  setup(ctx: ModuleContext): ModuleInstance | Promise<ModuleInstance>;
}
export interface ModuleInstance {
  tools?: ToolDef[];           // MCP 도구
  ingest?: IngestRoute[];      // 수집 입구 경로 (범위 포함)
  status?(): Promise<{ ok: boolean; detail?: string }>;
}
export interface ToolDef {
  name: string;                // 영어 식별자
  description: Text;           // 영어·한국어. settings.toolLanguage = en | ko | both
  input: ZodRawShape;
  readOnly?: boolean;
  destructive?: boolean;       // 켜기 전엔 숨김
  run(args, ctx): Promise<string>;
}
```

모듈 추가 = `src/modules/`에 폴더 하나 + `src/modules/index.ts`에 한 줄. 설정이 바뀌면 재시작 없이 다시 불러와요.

## 공급자 약속 ✅

```ts
export interface ProviderDef<K extends Kind, C, S> {
  kind: K;                     // "storage" | "mail" | "location" | "geocoder" | "health" | "tasks" | "calendar"
  id: string;                  // "imap", "gmail", "dawarich" …
  title: Text;
  config: ZodType<C>;          // 보이는 설정 → 관리 화면 폼 자동 생성
  secrets: ZodType<S>;         // 암호화, 쓰기 전용
  oauth?: OAuthSpec;           // "로그인" 버튼
  runtimes: ("node" | "workers")[];
  create(c: C, s: S, ctx): Promise<KindMap[K]>;
  test(p: KindMap[K]): Promise<TestResult>;   // [연결 시험]
}
```

## 공급자 종류

| 종류 | 인터페이스 | v1 | 나중 |
|---|---|---|---|
| storage | `read · write · list · stat · move` | fs ✅ · webdav ✅ · s3 ✅ · r2 ✅ · notion ✅ (beta) | git · couchdb · 클라우드 드라이브 |
| mail | `folders · search · read · digestFolders` | imap ✅ | gmail API |
| location | `points · areas · visits?` | dawarich ✅ · owntracks ✅ | 전용 앱 |
| geocoder | `reverse` | OpenStreetMap Nominatim ✅ | 카카오 로컬, 네이버 |
| health | 수집 본문 → 표준 기록 | 단축어 ✅ · Health Auto Export ✅ | Health Connect, 앱 |
| tasks | `lists · list · add · update · complete · delete` | google ✅ | todoist, 미리 알림 |
| calendar | `calendars · events` | 인터페이스만 | google, CalDAV |
| weather | `place · days(from, to)` | Open-Meteo ✅ | - |
| home | `states · logbook(from, to, entity?)` (read-only) | Home Assistant ✅ | - |
| music | `plays(from, to)` · `history` | Last.fm ✅ · Spotify ✅ (recent 50, collected every 30 min) | - |

## 모듈

| 모듈 | 도구 | 수집 | 노트 | 상태 |
|---|---|---|---|---|
| vault | `list_notes` `read_note` `search_notes` `vault_stats` `note_history` `write_note` `append_note` `delete_note` `move_note` | - | - | ✅ |
| hub | `hub_status`, `day_summary`, `week_summary` | - | - | ✅ |
| wiki | `wiki_layout` `wiki_lint` `wiki_save_source` `wiki_index` `wiki_backlinks` `wiki_log` `wiki_check` `wiki_pending` | - | 목차, 로그 | ✅ |
| ledger | `payments_day` ✅, `payments_from_mail` ✅ | `/ingest/message` `/ingest/transaction` | 결제, 돈 | ✅ |
| mail | `mail_folders` `mail_search` `mail_read` `mail_day` | - | - | ✅ ([메일](mail.md)) |
| location | `location_day` | `/ingest/owntracks` | - | ✅ ([위치](location.md)) |
| health | `health_day` | `/ingest/health` | 건강 | ✅ ([건강](health.md)) |
| tasks | `task_*` | - | - | ✅ ([할 일](tasks.md)) |
| calendar | `calendar_list` `calendar_events` | - | - | ✅ ([calendar](calendar.md)) |
| weather | `weather_days` | - | - | ✅ |
| home | `home_states` `home_day` | - | - | ✅ ([home](home.md)) |
| music | `music_day` | - | - | ✅ ([music](music.md)) |

## 결제: 메시지 레시피 ✅

```ts
interface Message   { channel: "sms" | "mail" | "notification" | "text"; from?: string; subject?: string; text: string }
interface Extractor { id: string; extract(m: Message): Extraction | null }   // 차례로: 볼트 레시피 → 기본 레시피 → 공통 해석기
// 못 읽음 → 대기함(암호화) → Claude가 처리하거나 레시피 노트를 제안
```

카드사·가게 추가 = 가짜 예시가 들어 있는 **레시피 하나**(볼트 노트의 JSON, 또는 저장소 `recipes/*.json`). 코드는 필요 없어요: [메시지 레시피](recipes.md). 공통 처리(중복, 취소, 교통·출입 구분, 온라인 판별, 늦게 온 문자)는 모듈에서 한 번만 해요. 집·회사 같은 내 장소는 코드가 아니라 설정이에요.

## 노트 그리기: 데이터 → 출력

모듈은 기록을 뷰 모델로 묶어 출력에 넘겨요: `obsidian-markdown`(v1), `notion-database`(나중). 사람과 같이 쓰는 노트는 자동 구역만 바꿔요.

```
<!-- memexhub:auto id=money -->
…자동 생성…
<!-- /memexhub:auto -->
```

## Notion ✅ 내보내기 · ✅ 저장소 (베타)

내보내기: [Notion](notion.md).

1. **출력 먼저**: 결제, 건강, 하루 같은 구조화된 기록을 Notion 데이터베이스 행으로. 변환 손실이 없고 Notion의 필터·합계가 그대로 돼요.
2. **저장소는 나중**: `notion` 저장소 어댑터 (폴더 → 상위 페이지, 노트 → 페이지). 위키링크·콜아웃·프론트매터가 깨지고 요청 제한이 있어요.

Obsidian과 Notion을 같이 쓰면 원본은 볼트, Notion은 출력만 해요. 양방향 동기화는 안 해요. Notion 통합에는 필요한 페이지만 공유하세요.
