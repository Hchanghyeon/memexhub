# memexhub 문서

[English](../README.md)

## 지금 되는 것

**모으기**

| 무엇 | 상태 |
|---|---|
| 폰 결제: 카드 문자(레시피), Apple Pay·교통 태그, 회사 출입 태그, 결제 메일(KCP·KICC) | ✅ |
| 메시지 읽기: 레시피 + 기본 읽기, 확인할 메시지, 답하면서 레시피 배우기, 레시피 모음(기본 꺼짐) | ✅ |
| 위치: OwnTracks(QR 설정)·Dawarich, 체류와 장소 이름(OSM), 지도 화면 | ✅ |
| 건강: iOS 단축어, Health Auto Export | ✅ |
| [식단](meals.md): 음식 사진이나 설명으로 Claude가 칼로리·영양 어림, 월별 식단 노트, 장면에 끼니 | ✅ |
| 공유 시트: 어느 앱에서든 공유한 링크·글을 위키 원본으로 (`/ingest/share`) | ✅ |
| 메일(IMAP, 읽기 전용): 카카오·네이버·Gmail·Outlook·직접 입력 | ✅ |
| 캘린더: Google(로그인), iCloud, CalDAV, **캘린더 링크(iCal, 반복 일정 펼침)** | ✅ |
| 날씨(Open-Meteo), 집(홈 어시스턴트, 엔티티 목록에서 고르기), 음악(Last.fm·Spotify), 할 일(Google Tasks) | ✅ |

**정리하기**

| 무엇 | 상태 |
|---|---|
| 위키 엔진: 역할과 프리셋, 원본(한 번만 씀), 목차·하위 목차, 로그, 역링크, 점검 규칙 | ✅ |
| 하네스: 쓰기 검사, `draft → stable → deprecated`, `wiki_check`, `wiki_pending` | ✅ |
| 검색 색인(FTS5) · 볼트 변경 이력(git, 이전 판 되돌리기) | ✅ |
| 결제·돈 노트, 건강 노트를 엔진이 다시 그림 (연도별 또는 월별) | ✅ |
| 대화에서 정한 것 저장(`conversation_save`) | ✅ |

**꺼내 주기**

| 무엇 | 상태 |
|---|---|
| MCP 커넥터 하나 (OAuth 2.1), 서버 안내문 | ✅ |
| `day_summary`(맨 앞에 **장면**: 일정·체류·결제를 시간으로 합침) · `week_summary` | ✅ |
| 바로 쓰는 Claude 루틴: 하루 일지, 위키 수집, 주간 점검 | ✅ |
| Notion 내보내기(결제, 건강) | ✅ |

**관리 화면과 설치** ([화면 안내](admin-ui.md))

| 무엇 | 상태 |
|---|---|
| 3단계 처음 설정, 폰 설정 QR, 2단계 인증 QR | ✅ |
| 노트 보기(사진·PDF, 콜아웃·형광펜, 이전 판), 하루 지도 | ✅ |
| 연결: 짧은 이름, 칸마다 한국어 설명, 수정·삭제, 오류를 할 일 문장으로 | ✅ |
| 메시지 화면(확인해 주세요 · 알아서 읽는 곳 · 레시피 모음 · 레시피란?) | ✅ |
| 볼트 저장소: 서버 안·서버 폴더, WebDAV, S3·R2·MinIO, Notion(베타) · Git 📝 | ✅ |
| 옵시디언 동기화용 내장 WebDAV, 백업(암호화)·복원·옮겨오기 | ✅ |
| Docker(서명된 이미지), Cloudflare 버튼, 홈 어시스턴트 애드온·시놀로지·Railway | ✅ (첫 릴리스 후) |
| 로고, 아이폰 홈 화면 아이콘 | ✅ |

## 시작
- [관리 화면 안내](admin-ui.md): 화면마다 무엇을 하는지
- [Docker로 설치](install.md): 실행, 밖으로 열기, 서명 확인, 업그레이드
- [다른 설정에서 옮겨오기](migrating.md): 결제·건강·기기 토큰 가져오기
- [Cloudflare (서버 없이)](cloudflare.md): 배포 버튼, Workers + D1 + R2
- [홈 어시스턴트, 시놀로지, Railway](app-stores.md)
- [쉬운 설치](easy-install.md): 한눈에 보기

## Claude와 쓰기
- [Claude 연동](claude-integration.md): 커넥터, OAuth, `day_summary` / `week_summary`
- [위키 엔진](wiki-engine.md): 역할, 프리셋, 점검, 원본, 목차, 로그
- [결제](ledger.md): 결제·돈 노트 · [메시지 레시피](recipes.md) · 코드 없이 문자·메일·알림 해석
- [메일](mail.md) · [위치](location.md) · [건강](health.md) · [식단](meals.md) · [할 일](tasks.md) · [캘린더](calendar.md) · [집](home.md) · [음악](music.md) · [Notion](notion.md)

## 운영
- [설정과 저장소](configuration-and-storage.md): 환경 변수, 볼트 저장소, 내장 WebDAV, 백업
- [보안](security.md): 위협 모델 · [보안 점검](../security-review.md) (영문) · 항목별 증명

## 개발
- [구조](architecture.md) · [모듈과 공급자](modules-and-providers.md) · [공급자 추가](adding-a-provider.md)
- [개발 규칙](development.md): 브랜치, 커밋, 개인 정보, 의존성, PR · [UI 원칙](design.md) · [로드맵](roadmap.md)
