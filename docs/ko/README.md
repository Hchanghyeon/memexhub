# memexhub 문서

[English](../README.md)

## 지금 되는 것

| 영역 | 상태 |
|---|---|
| core (설정, 암호화된 연결, 기록, 감사), 실행 환경 층 | ✅ |
| 볼트 저장소: 서버 내장·서버 폴더, WebDAV, S3·R2·MinIO | ✅ · Git 📝 |
| 볼트 도구 (목록·읽기·검색·통계·쓰기·덧붙이기·휴지통·이동) + 보호 경로 | ✅ |
| Claude 커넥터용 OAuth 2.1, 기기 토큰, IP 허용 목록 | ✅ |
| 관리 화면: 3단계 처음 설정, 연결, 기기(폰 설정 QR), 2단계 인증 QR, 사진·PDF까지 보는 노트 뷰어, 하루 지도 | ✅ |
| 위키 모듈 (구조, 점검, 원본 저장, 목차, 로그, 역링크), 역할과 프리셋, 한 번만 쓰는 원본 | ✅ |
| 위키 하네스: 쓰기 검사, 관리 화면에서 확인하는 `draft → stable → deprecated`, `wiki_check`, `wiki_pending` | ✅ |
| 결제: 카드 문자(현대·삼성), Apple Pay·교통, 결제·돈 노트, 결제 메일, `payments_day`, 메시지 레시피 + 대기함 | ✅ |
| 메일 (읽기 전용 IMAP: 카카오, 네이버, Gmail, Outlook, 직접 입력) | ✅ |
| 위치(Dawarich, OwnTracks, OSM 지명), `location_day`, 결제 장소 이름, 지도 화면 | ✅ |
| 캘린더(CalDAV, iCloud, Google), 날씨, 홈 어시스턴트, 음악(Last.fm, Spotify) | ✅ |
| 건강(iOS 단축어, Health Auto Export), 건강 노트, `health_day` | ✅ |
| 할 일(Google Tasks, 계정 여러 개, 로그인 버튼) | ✅ |
| `day_summary`, `week_summary` (루틴용 하루·한 주 한 번에) | ✅ |
| 서버 볼트를 Obsidian과 동기화하는 내장 WebDAV | ✅ |
| Notion 내보내기 (결제, 건강) | ✅ |
| Cloudflare 버튼 설치 (Workers + D1 + R2) | ✅ |
| 홈 어시스턴트 애드온, 시놀로지, Railway | ✅ (첫 릴리스 후) |
| Notion을 볼트 저장소로 (베타, 작은 볼트) | ✅ |
| 공유 시트: 폰 앱에서 공유한 것을 원본으로 (`/ingest/share`) | ✅ |
| `day_summary`의 장면(일정·체류·결제를 시간으로 합침) · 바로 쓰는 Claude 루틴 | ✅ |

## 시작
- [Docker로 설치](install.md): 실행, 밖으로 열기, 서명 확인, 업그레이드
- [다른 설정에서 옮겨오기](migrating.md): 결제·건강·기기 토큰 가져오기
- [Cloudflare (서버 없이)](cloudflare.md): 배포 버튼, Workers + D1 + R2
- [홈 어시스턴트, 시놀로지, Railway](app-stores.md)
- [쉬운 설치](easy-install.md): 한눈에 보기

## Claude와 쓰기
- [Claude 연동](claude-integration.md): 커넥터, OAuth, `day_summary` / `week_summary`
- [위키 엔진](wiki-engine.md): 역할, 프리셋, 점검, 원본, 목차, 로그
- [결제](ledger.md): 결제·돈 노트 · [메시지 레시피](recipes.md) · 코드 없이 문자·메일·알림 해석
- [메일](mail.md) · [위치](location.md) · [건강](health.md) · [할 일](tasks.md) · [캘린더](calendar.md) · [집](home.md) · [음악](music.md) · [Notion](notion.md)

## 운영
- [설정과 저장소](configuration-and-storage.md): 환경 변수, 볼트 저장소, 내장 WebDAV, 백업
- [보안](security.md): 위협 모델 · [보안 점검](../security-review.md) (영문) · 항목별 증명

## 개발
- [구조](architecture.md) · [모듈과 공급자](modules-and-providers.md) · [공급자 추가](adding-a-provider.md)
- [개발 규칙](development.md): 브랜치, 커밋, 개인 정보, 의존성, PR · [UI 원칙](design.md) · [로드맵](roadmap.md)
