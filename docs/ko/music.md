# 음악

memexhub가 들은 음악을 읽어서(읽기 전용) 일지에 써요: `music_day`는 그날 곡 목록, `day_summary`에는 한 줄("음악 23곡 · 많이 들은 아티스트: …").

| 서비스 | 설정 | 기록 |
|---|---|---|
| **Last.fm** | 사용자 이름과 last.fm/api/account/create 의 API 키 | Last.fm에 있는 전부 |
| **Spotify** | developer.spotify.com 에서 앱을 만들고, 폼에 나온 리디렉션 URI를 추가하고, Client ID·Secret을 저장한 뒤 **Spotify로 로그인** | Spotify는 최근 50곡만 보여줘서, 연결한 순간부터 30분마다 모아요 |

Spotify에는 읽기 권한 `user-read-recently-played`만 요청해요. 재생·저장·게시는 절대 안 해요.
