# Docker로 설치

## 1. 실행

```bash
mkdir memexhub && cd memexhub
curl -O https://raw.githubusercontent.com/Hchanghyeon/memexhub/main/compose.example.yml && mv compose.example.yml compose.yml
cat > .env <<ENV
MEMEXHUB_SECRET=$(openssl rand -base64 48)
PUBLIC_URL=https://memex.example.com
TZ=Asia/Seoul
ENV
chmod 600 .env
docker compose up -d
docker compose logs memexhub | grep -i "setup code"
```

**`MEMEXHUB_SECRET`은 백업과 따로 안전하게 보관하세요.** 연결 비밀값과 백업을 이걸로 암호화해서, 없으면 복원할 수 없어요.

## 2. 밖으로 열기

| 포트 | 무엇 | 열까? |
|---|---|---|
| 8787 | Claude용 MCP (+ OAuth, Google 로그인 콜백) | 예, `PUBLIC_URL`의 HTTPS 뒤로 |
| 8790 | 기기 수집, `/dav/` 볼트 동기화 | 예, HTTPS 뒤로 (다른 호스트 이름이나 경로) |
| 8791 | 관리 화면 | **아니오** — 내부망만 (compose 파일이 127.0.0.1에만 열어요) |

HTTPS 리버스 프록시나 터널이면 뭐든 돼요 (Caddy, Nginx, 시놀로지 역방향 프록시, Cloudflare Tunnel). 포트 하나로 쓰려면 `LISTEN=single` (관리 화면은 `/admin`, 여전히 내부망만).

## 3. 설정

관리 화면을 열고 (예: SSH 터널 `ssh -L 8791:127.0.0.1:8791 내서버` 후 `http://localhost:8791`), 설치 코드를 넣고 마법사를 따라가요.

## 이미지 확인

릴리스 이미지는 모두 Sigstore로 서명돼 있고(이 저장소의 릴리스 워크플로가 키 없이 서명), SBOM과 빌드 출처 증명이 붙어 있어요.

```bash
cosign verify ghcr.io/hchanghyeon/memexhub:0.1.0 \
  --certificate-identity-regexp '^https://github.com/Hchanghyeon/memexhub/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/hchanghyeon/memexhub:0.1.0 --repo Hchanghyeon/memexhub
```

## 업그레이드

1. 관리 화면 → Backups → **Download a backup now**
2. `compose.yml`의 이미지 태그를 바꾸기 (`latest` 말고 `0.2.0`처럼 버전 고정)
3. `docker compose pull && docker compose up -d` — DB 마이그레이션은 시작할 때 자동으로 돌아요

## compose 예시의 보안 설정

root 아닌 사용자, 읽기 전용 루트 파일 시스템, `cap_drop: ALL`, `no-new-privileges`, 메모리·프로세스 제한, 쓰기는 `/data`(와 `/vaults` 아래 볼트 폴더)만, 관리 포트는 localhost에만. 베이스 이미지는 digest로 고정하고 Dependabot이 최신으로 유지해요.
