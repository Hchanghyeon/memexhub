# Home Assistant, Synology, Railway

All three run the same signed image (`ghcr.io/hchanghyeon/memexhub`, see [install](install.md#verify-the-image)).

## Home Assistant add-on

1. Settings → Add-ons → Add-on store → ⋮ → **Repositories** → add `https://github.com/Hchanghyeon/memexhub`.
2. Install **memexhub**, fill in `memexhub_secret` (48+ random characters: keep a copy), `public_url` (the https address Claude uses) and `timezone`.
3. Start it, copy the setup code from the **Log** tab, open `http://<home assistant>:8791` and follow the wizard.

Data is in the add-on's `/data` and goes into Home Assistant backups. Put port 8787 (and 8790 for devices) behind HTTPS: for example a Cloudflare Tunnel or your reverse proxy.

## Synology (Container Manager)

1. Container Manager → **Project** → Create → choose a folder in a shared folder (e.g. `docker/memexhub`) → **Create docker-compose.yml** and paste [`compose.example.yml`](../compose.example.yml).
2. Next to it create `.env` with `MEMEXHUB_SECRET`, `PUBLIC_URL`, `TZ` (see [install](install.md)).
3. Build → open the container log for the setup code → `http://<nas>:8791`.
4. Control Panel → Login Portal → Advanced → **Reverse Proxy**: your https host name → `localhost:8787` (Claude) and another one → `localhost:8790` (devices). Don't proxy 8791.

## Railway

1. New project → **Deploy from GitHub repo** (your fork of memexhub). Railway builds the Dockerfile (`railway.json`).
2. Variables: `MEMEXHUB_SECRET` (48+ random characters), `ADMIN_PUBLIC=1`, `TZ`. Railway's `PORT` switches memexhub to one listener: Claude at `/mcp`, devices at `/ingest/…`, admin at `/admin`.
3. Add a **volume** mounted at `/data`.
4. Settings → Networking → generate a domain; set `PUBLIC_URL` to it.
5. Open `https://<domain>/admin/setup` with the setup code from the deploy log; **two-factor is required** before anything else (the admin UI is on the internet).

`ADMIN_PUBLIC=1` lets the admin UI answer over the internet, always with two-factor; within 24 h of creating the account you may sign in to enrol it.
