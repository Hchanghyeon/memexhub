# Install with Docker

## 1. Run

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

**Keep `MEMEXHUB_SECRET` safe and separate from backups**: it encrypts connection secrets and backups; without it they cannot be restored.

## 2. Expose

| Port | What | Expose? |
|---|---|---|
| 8787 | MCP for Claude (+ OAuth, Google sign-in callback) | yes, behind HTTPS at `PUBLIC_URL` |
| 8790 | ingest for devices, `/dav/` vault sync | yes, behind HTTPS (another host name or path) |
| 8791 | admin UI | **no**: private network only (the compose file binds it to 127.0.0.1) |

Any HTTPS reverse proxy or tunnel works (Caddy, Nginx, Synology reverse proxy, Cloudflare Tunnel). One port instead of three: `LISTEN=single` (admin under `/admin`, still private-network only).

## 3. Set up

Open the admin UI (e.g. through an SSH tunnel: `ssh -L 8791:127.0.0.1:8791 your-server`, then `http://localhost:8791`), enter the setup code and follow the wizard.

## Verify the image

Every release image is signed with Sigstore (keyless, by this repository's release workflow) and has SBOM and build provenance attached.

```bash
cosign verify ghcr.io/hchanghyeon/memexhub:0.1.0 \
  --certificate-identity-regexp '^https://github.com/Hchanghyeon/memexhub/\.github/workflows/release\.yml@refs/tags/v' \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
gh attestation verify oci://ghcr.io/hchanghyeon/memexhub:0.1.0 --repo Hchanghyeon/memexhub
```

## Upgrade

1. Admin UI → Backups → **Download a backup now**.
2. Change the image tag in `compose.yml` (pin versions, e.g. `0.2.0`, rather than `latest`).
3. `docker compose pull && docker compose up -d`: database migrations run automatically on start.

## Hardening in the compose example

Non-root user, read-only root filesystem, `cap_drop: ALL`, `no-new-privileges`, memory and process limits, only `/data` (and an optional vault folder under `/vaults`) writable, admin port bound to localhost. The base image is pinned by digest and kept current by Dependabot.
