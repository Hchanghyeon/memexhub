# 홈 어시스턴트, 시놀로지, Railway

셋 다 같은 서명된 이미지(`ghcr.io/hchanghyeon/memexhub`, [설치](install.md#이미지-확인))를 써요.

## 홈 어시스턴트 애드온

1. 설정 → 애드온 → 애드온 스토어 → ⋮ → **저장소** → `https://github.com/Hchanghyeon/memexhub` 추가
2. **memexhub** 설치 → `memexhub_secret`(랜덤 48자 이상, 사본 보관), `public_url`(Claude가 쓸 https 주소), `timezone` 입력
3. 시작 → **로그** 탭에서 설치 코드 복사 → `http://<홈 어시스턴트>:8791` 열고 마법사 따라가기

데이터는 애드온의 `/data`에 있고 홈 어시스턴트 백업에 함께 들어가요. 8787(기기용은 8790)은 HTTPS 뒤로 여세요: 예: Cloudflare Tunnel이나 리버스 프록시.

## 시놀로지 (Container Manager)

1. Container Manager → **프로젝트** → 생성 → 공유 폴더 안의 폴더 지정(예: `docker/memexhub`) → **docker-compose.yml 만들기**에 [`compose.example.yml`](../../compose.example.yml) 붙여 넣기
2. 같은 폴더에 `.env` 만들기: `MEMEXHUB_SECRET`, `PUBLIC_URL`, `TZ` ([설치](install.md) 참고)
3. 빌드 → 컨테이너 로그에서 설치 코드 → `http://<NAS>:8791`
4. 제어판 → 로그인 포털 → 고급 → **역방향 프록시**: https 호스트 이름 → `localhost:8787`(Claude), 다른 이름 → `localhost:8790`(기기). 8791은 프록시하지 마세요.

## Railway

1. 새 프로젝트 → **GitHub 저장소에서 배포**(memexhub 포크). Railway가 Dockerfile로 빌드해요(`railway.json`).
2. 변수: `MEMEXHUB_SECRET`(랜덤 48자 이상), `ADMIN_PUBLIC=1`, `TZ`. Railway의 `PORT`가 있으면 포트 하나로 동작해요: Claude는 `/mcp`, 기기는 `/ingest/…`, 관리 화면은 `/admin`.
3. `/data`에 **볼륨** 붙이기
4. Settings → Networking → 도메인 만들기 → `PUBLIC_URL`을 그 주소로
5. 배포 로그의 설치 코드로 `https://<도메인>/admin/setup` 열기: 관리 화면이 인터넷에 있으니 **2단계 인증을 먼저** 켜야 해요

`ADMIN_PUBLIC=1`은 관리 화면을 인터넷에서 열되 항상 2단계 인증을 요구해요. 계정을 만든 지 24시간 안에는 등록을 위해 로그인할 수 있어요.
