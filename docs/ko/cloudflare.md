# Cloudflare (서버 없이)

memexhub를 **내 Cloudflare 계정의 Workers**에서 돌릴 수 있어요. 한 사람이 쓰기엔 무료 요금제로 충분해요. Worker 하나가 Claude 커넥터(`/mcp`), 기기(`/ingest/…`), 관리 화면(`/admin`)을 맡고, **D1**에 설정·기록, **R2** 버킷에 볼트를 두고, **Cron 트리거**가 주기 작업을 돌려요.

## 배포

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Hchanghyeon/memexhub)

버튼을 누르면 저장소가 내 계정으로 복사되고, `wrangler.toml`대로 D1 데이터베이스와 R2 버킷이 만들어지고, 비밀값 두 개를 물어봐요.

| 비밀값 | 값 |
|---|---|
| `MEMEXHUB_SECRET` | 긴 랜덤 값 (`openssl rand -base64 48`, 또는 비밀번호 생성기로 48자 이상). **사본을 꼭 보관하세요**: 연결과 백업을 이걸로 암호화해요. |
| `SETUP_CODE` | 내가 정하는 일회용 코드 (영문·숫자 12자 이상). 다음 단계에서 입력해요 |

버튼 없이: `npm ci && npx wrangler deploy` 후 `npx wrangler secret put MEMEXHUB_SECRET`, `… SETUP_CODE`.

## 설정

1. `https://<내 worker>.workers.dev/admin/setup`을 열고 설치 코드를 넣어 관리자 계정을 만들어요.
2. **2단계 인증 켜기**: 켜기 전엔 이 화면만 열려요(여기선 관리 화면이 인터넷에 있으니까요).
3. 마법사가 이어져요: 시간대, 볼트(**이 Worker의 R2 버킷**), 위키 구조, Claude 커넥터 `https://<내 worker>.workers.dev/mcp`.

`PUBLIC_URL`은 기본으로 Worker 주소예요. 내 도메인을 붙이면 `PUBLIC_URL`을 그 주소로 바꾸고(Settings → Variables) Claude 커넥터를 다시 연결하세요.

## 폰·PC에서 볼트 쓰기

Obsidian → **Remotely Save** → S3: 엔드포인트 `https://<계정 ID>.r2.cloudflarestorage.com`, 리전 `auto`, 버킷 `memexhub-vault`, 그 버킷만 허용한 **R2 API 토큰**(R2 → Manage API tokens).

## Workers에서 다른 점

| | Workers | Docker / 서버 |
|---|---|---|
| 볼트 | R2 버킷 (또는 다른 곳의 WebDAV·S3) | 서버 내장 폴더, 서버 폴더, WebDAV, S3 |
| 내장 WebDAV `/dav/` |: R2에 S3로 Remotely Save 사용 | ✅ |
| 메일 (IMAP) |: 아직 안 됨 (TCP 소켓 필요) | ✅ |
| 위치 | OwnTracks ✅ · Dawarich는 인터넷에서 닿을 때 | ✅ |
| 백업 | 관리 화면에서 내려받기 | 내려받기 + 매일 파일 |
| 관리 화면 | 인터넷 + 2단계 인증 | 내부망 |

나머지: 위키 엔진, 결제·레시피, 건강, Google Tasks, Notion, 요약 · 는 똑같아요.
