# 쉬운 설치 (계획)

목표: 백엔드를 못 다루는 사람도 버튼 몇 번으로 띄우기. 데이터는 여전히 **각자의 계정**에 있어요. memexhub가 대신 맡아 주는 서비스가 아니에요.

| 길 | 이런 사람 | 비용 | 방법 |
|---|---|---|---|
| **A. 버튼 하나 (Cloudflare)** | 서버 없음, 코딩 모름 | 대부분 무료 | *Deploy to Cloudflare* → 내 계정에 Workers + D1 + R2 + Cron → 주소 열기 → 설치 마법사 |
| B. 클라우드 템플릿 | IMAP 메일·Dawarich까지 쓰고 싶음 | 월 몇 달러 | Railway · Render · Fly 버튼 |
| C. 앱스토어 | NAS나 홈 어시스턴트가 있음 | 전기세 | 홈 어시스턴트 애드온 · 시놀로지 · Unraid · CasaOS/Umbrel |
| D. docker compose | 개발자 | - | `compose.example.yml` |

## A 길: 서버 없이

| 필요한 것 | 방법 |
|---|---|
| 볼트 | R2 + 기기의 Obsidian **Remotely Save(S3)**. memexhub도 같은 버킷을 s3 어댑터로 (또는 GitHub + Obsidian Git) |
| DB | D1 (같은 스키마) |
| 위치 | **OwnTracks** 앱 → memexhub의 OwnTracks 호환 수집 경로 |
| 메일 | Gmail 로그인 버튼. IMAP은 Workers TCP가 허용하는 범위에서 |
| 예약 작업 | Cron Triggers |
| HTTPS 주소 | `*.workers.dev` |

## 쉽게 만드는 장치

1. **설치 코드**: 공개 주소에 띄운 직후 스캐너가 먼저 차지하지 못하게 ([보안](security.md) T11)
2. **열쇠 대신 버튼**: 구글·Gmail·Notion 로그인 버튼, IMAP 프리셋, 단계마다 [연결 시험]
3. **단축어는 링크로**: iCloud 링크 + 주소·토큰 복사 버튼
4. **Claude 커넥터 안내**: 주소 복사 + 스크린샷 3장
5. **볼트 깔아 주기**: 프리셋대로 폴더와 규칙 노트. 첫 프롬프트로 Claude가 인터뷰해서 내 규칙을 채워 줘요
6. **루틴 프롬프트**: 밤 정리, 주간 회고, 위키 점검을 한 줄씩 복사해서 붙이기
7. **체크리스트 형식의 설치 문서**: Claude가 따라 안내하기 좋게
8. **새 버전 알림과 업데이트 버튼**

## 실행 환경 층

| 부분 | Node (B, C, D) | Workers (A) |
|---|---|---|
| 진입점 | `src/main.ts` (포트 셋) | `worker.ts` (한 주소, 경로로 나눔) |
| DB | better-sqlite3 | D1 |
| 비밀 | 환경 변수 | Worker 비밀 |
| 예약 작업 | 서버 안 | Cron Triggers |
| 볼트 | fs · webdav · s3 · git | s3(R2) · webdav · git |
| 바깥 TCP | 가능 (IMAP) | 제한 |

공급자는 자기가 도는 환경을 밝히고, 마법사는 안 되는 건 이유와 함께 흐리게 보여 줘요. CI가 core에서 `node:*`를 못 쓰게 막아요.
