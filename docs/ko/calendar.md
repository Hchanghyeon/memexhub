# 캘린더

memexhub가 캘린더를 읽어서(읽기 전용) Claude가 `day_summary`로 하루 일정을 보고, `calendar_events`로 "금요일에 뭐 있어?"에 답해요. 반복 일정은 서버가 펼쳐서 줘요.

| 서비스 | 연결 | 주소 | 비밀번호 |
|---|---|---|---|
| Google | **Google 캘린더** → *Google로 로그인* | (고정) | Google Cloud의 OAuth 클라이언트(웹 애플리케이션)와 Google Calendar API. 읽기 권한만 요청해요 |
| iCloud | **iCloud 캘린더** | (고정) | appleid.apple.com → 로그인 및 보안 → 앱 암호 |
| 네이버 | **CalDAV** | `https://caldav.calendar.naver.com` | 네이버 비밀번호 (2단계 인증이면 애플리케이션 비밀번호) |
| 시놀로지 캘린더 | **CalDAV** | `https://<NAS>:5001/caldav/` — "집 네트워크" 체크 | DSM 비밀번호 |
| Nextcloud · Fastmail · Radicale | **CalDAV** | 서비스 설정의 CalDAV 주소 | (앱) 비밀번호 |

**여러 계정**: 계정마다 연결을 하나씩 만들어요(예: `personal`, `work`). Google은 로그인된 연결의 **계정 추가**를 누르면 같은 Google Cloud 앱을 그대로 써서 다른 계정으로 로그인만 하면 돼요. 새 Google 할 일·캘린더 연결도 이 앱을 다시 쓸 수 있어요. 계정이 여러 개면 일정 줄마다 어느 계정인지 붙어요. 연결마다 따로 끄고, 시험하고, 캘린더를 골라요.

`calendars`에 이름을 쉼표로 적으면 그 캘린더만 읽어요. 비우면 전부요.

도구: `calendar_list`(계정과 캘린더), `calendar_events`(날짜, 62일까지, 계정). 캘린더에 아무것도 쓰지 않아요.
