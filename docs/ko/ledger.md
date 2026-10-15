# 결제 (ledger)

기기가 결제 순간 기록을 보내면(폰 자동화, 앱, HTTP를 보낼 수 있는 스크립트 무엇이든), 엔진이 연도별 **결제 노트**와 **돈 노트**를 최신으로 유지해요. ✅

## 기록이 들어오는 길

| 주소 | 보통 보내는 쪽 | 본문 |
|---|---|---|
| `POST /ingest/message` | **해석할 원문** — 카드 문자(iOS 단축어 *메시지* 자동화, Android Tasker·MacroDroid), 앱 알림, 붙여 넣은 글 | `{ "channel": "sms" \| "notification" \| "mail" \| "text", "text", "from"?, "subject"?, "time"?, "lat"?, "lon"? }` |
| `POST /ingest/transaction` | **이미 정리된** 결제 — 지갑 결제 — iOS 단축어 *거래* 자동화 (Apple Pay, 교통카드), 또는 어떤 앱이든 | `{ "merchant", "amount", "card", "name", "time"?, "lat"?, "lon"?, "kind"?: "online" \| "taxi", "item"? }` |

헤더 `X-Ingest-Token: <범위 ledger 기기 토큰>`. `POST /ingest/sms`에 `{ "text", "lat"?, "lon"? }`를 보내면 `"channel": "sms"`인 `/ingest/message`와 같아요. 본문은 4KB까지(`/ingest/message`는 20KB), 모르는 칸이 있으면 거절하고, 거절한 요청은 값 없이 기록해요.

카드 문자는 공통 해석기와 볼트 노트로 저장되는 작은 **레시피**로 읽어요(기본: 현대카드·삼성카드 문자, NHN KCP 결제 메일). 못 읽은 건 대기함에서 Claude를 기다리고, Claude가 레시피를 제안할 수 있어요 — [메시지 레시피](recipes.md).

## 아이폰 설정 (iOS 단축어)

1. 관리 화면 → *Device tokens* → 범위 `ledger`로 토큰 만들기. 한 번만 보이니 복사해 두세요.
2. **카드 문자** — 단축어 → 자동화 → *메시지* → *보낸 사람*: 카드사 → *즉시 실행* → *URL 콘텐츠 가져오기*:
   URL `https://<수집 주소>/ingest/message`, 방법 `POST`, 헤더 `X-Ingest-Token`, 본문 *JSON*에 `channel` = `sms`, `text` = *단축어 입력 → 내용*.
   선택: *현재 위치 가져오기*로 `lat`/`lon`을 같이 보내면 장소 이름에만 쓰고 저장하지 않아요.
3. **Apple Pay·교통** — 자동화 → *거래* → 카드 선택 → *즉시 실행* → `/ingest/transaction`으로 *URL 콘텐츠 가져오기*, *거래* 변수에서 `merchant`, `amount`, `card`, `name`.

## Android 설정

문자를 받으면 HTTP 요청을 보낼 수 있는 자동화 앱이면 돼요 (예: Tasker, MacroDroid).
트리거 *문자 수신*(보낸 사람: 카드사) → *HTTP 요청* `POST https://<수집 주소>/ingest/message`,
헤더 `X-Ingest-Token`, JSON 본문 `{"channel": "sms", "text": "<문자 내용>"}`. 앱 알림도 `"channel": "notification"`으로 똑같이 보내면 돼요. 엔진은 어느 기기가 보냈는지 따지지 않아요.

## 엔진이 하는 일

- **중복 거르기**: 5분 안의 같은 금액은 한 건이에요 (문자와 Apple Pay가 둘 다 보내는 경우). 취소는 거르지 않아요.
- **교통 vs 출입**: 금액 없는 교통카드 태그는 이동, *회사 장소*로 등록한 곳에서 찍힌 건 회사 출입이에요.
- **온라인·정기**: 스트리밍, 온라인 쇼핑 같은 곳은 🌐로 표시하고 장소를 안 붙여요.
- **늦게 온 문자**(결제 후 10분 넘게)는 장소를 안 붙여요.
- **좌표**는 위치 공급자가 연결돼 있을 때 장소 이름으로만 바꾸고 저장하지 않아요.

## 노트

| 노트 | 기본 경로 | 내용 |
|---|---|---|
| 결제 | `ledger/payments/{year}.md` | 월·일 제목과 합계, 결제 표, 🚇 교통 줄, 🏢 출입 줄. **기록마다 다시 그려요 — 손으로 고치지 마세요.** |
| 돈 | `ledger/money.md` | 직접 쓰는 칸(*수동 고정비*, *메모*) + **자동 구역**: 이번 달, 많이 쓴 곳, 카드별, 월별, 반복 결제(구독 vs 자주 가는 곳) |

경로, 노트 언어(`en`/`ko`), 회사 장소: 관리 화면 → *Features* → *Ledger*.

## 도구

| 도구 | 하는 일 |
|---|---|
| `payments_day(date)` ✅ | 하루치 결제, 합계, 교통·출입을 짧게 |
| `payments_from_mail(since?, until?)` ✅ | 결제 메일 폴더를 지금 읽어요(평소엔 15분마다). 같은 레시피로 해석하고, 같은 메일은 한 번만 |
| `ledger_inbox` · `ledger_inbox_resolve` · `ledger_recipe_propose` · `ledger_recipes` ✅ | 못 읽은 메시지와 레시피 — [메시지 레시피](recipes.md) |
