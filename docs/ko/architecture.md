# 구조

memexhub는 서버 하나에 입구 세 개, 작은 core, 갈아끼울 수 있는 모듈과 공급자로 이뤄져요.

```
 폰 단축어·앱 ──(기기 토큰)──▶ 수집 :8790  /ingest/*
 Claude 앱·루틴 ─(OAuth 2.1)─▶ MCP  :8787  /mcp · /authorize · /token · /register
 나, 내부망 ──(로그인+2FA)───▶ 관리 :8791  설치 마법사 · 연결 · 토큰

 ┌───────────────────────────────────────────────────────┐
 │ Hub (조립 지점) — 모듈을 불러오고 MCP 서버를 만듦          │
 ├───────────────────────────────────────────────────────┤
 │ 모듈      vault · hub · wiki · ledger · mail · location … │ 플러그인
 │ core      설정 · 연결 · 기록(events) · 감사 · 등록         │
 │ auth      관리자 · OAuth · 수집 토큰                      │
 │ storage   SafeVault ▶ VaultStorage (fs·webdav·s3·git)    │ 어댑터
 │ platform  DB · 비밀 · 시계 · fetch · 로그                 │ node | workers
 └───────────────────────────────────────────────────────┘
   DATA_DIR/memexhub.db  설정 · 암호화된 연결 · 토큰 · 기록 · 감사
```

## 원칙

1. **LLM Wiki가 먼저.** 목표는 나와 Claude가 같이 키우는 위키예요. 생활 기록 수집은 원본이 들어오는 길 중 하나예요.
2. **폴더가 아니라 역할.** 엔진은 볼트 구조를 가정하지 않아요 ([위키 엔진](wiki-engine.md)).
3. **계산은 엔진, 판단은 Claude.** 합계, 표, 링크 점검, 목차처럼 정답이 있는 일은 엔진이 해요. 해석과 글은 Claude가 해요.
4. **바깥 연결은 전부 갈아끼울 수 있어요.** 저장소, 메일, 위치, 지명, 건강, 할 일, 일정 모두 인터페이스 뒤에 있어요.
5. **기본값이 안전하고, 코드는 공개.** [보안](security.md) 참고.
6. **작고 어디서나.** 런타임 의존성 5개. core는 웹 표준만 써서 Node와 Cloudflare Workers에서 같이 돌아요.

## 입구

| 입구 | 기본 포트 | 누가 | 인증 | 밖에 여나 |
|---|---|---|---|---|
| MCP | 8787 | Claude(Anthropic 서버), 커넥터 로그인 때 내 브라우저 | OAuth 2.1 | HTTPS 뒤로 열어요. Anthropic IP만 받게 할 수 있어요 |
| 수집 | 8790 | 폰 단축어, 앱 | 범위(scope)가 있는 기기 토큰 | HTTPS 뒤로 열어요 |
| 관리 | 8791 | 나 | 비밀번호 + TOTP 선택, 세션 쿠키, CSRF | 기본은 내부망만 |

`LISTEN=single`이면 한 포트에서 경로로 나눠요 (간단한 설치, Workers).

## 흐름

**카드 문자가 오면** — 단축어 → `POST /ingest/sms`(기기 토큰, 범위 `ledger`) → 카드사 해석기 → 중복 확인 → `EventBus.append` → 렌더러가 결제·돈 노트를 다시 그림 → `SafeVault.write` (내용이 같으면 안 씀)

**Claude가 하루를 정리하면** — 밤 루틴 → `day_summary(date)` 한 번 (체류, 결제, 교통, 건강, 메일 수) → Claude가 판단하고 `write_note`로 일지 칸을 씀

**메일 계정을 추가하면** — 관리 화면 → 연결 → IMAP 입력 → [시험] → 비밀번호는 암호화해서 저장 → 재시작 없이 메일 모듈이 반영 → Claude는 `mail_search(account="회사")`

## 쓰는 디자인 패턴

| 패턴 | 어디서 |
|---|---|
| Strategy / Adapter | 저장소 어댑터, 공급자, 실행 환경(Node / Workers) |
| Decorator | `SafeVault`가 어떤 저장소든 감싸서 경로 정책·보호 경로·크기 제한·휴지통·감사를 덧씌움 |
| Registry / Plugin | `src/modules/index.ts`, 공급자 등록 |
| Factory | 연결 정보로 저장소·공급자 만들기 |
| Chain of Responsibility | 카드사 해석기를 차례로 시도 |
| Observer | `EventBus` → 기록이 오면 렌더러가 노트를 다시 그림 |
| Repository | 설정, 연결, 토큰, 기록 |
| Builder | 요청마다 보이는 도구만 담은 MCP 서버를 새로 만듦 |
