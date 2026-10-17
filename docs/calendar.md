# Calendar

memexhub reads your calendars (read-only) so Claude sees your day in `day_summary` and can answer "what is on Friday?" with `calendar_events`. Recurring events are expanded by the server.

| Service | Connection | Address | Password |
|---|---|---|---|
| Google | **Google Calendar** → *Sign in with Google* | (fixed) | an OAuth client from Google Cloud (Web application) with the Google Calendar API on; only read-only access is asked |
| iCloud | **iCloud Calendar** | (fixed) | an app-specific password from appleid.apple.com → Sign-In and Security |
| Naver | **CalDAV** | `https://caldav.calendar.naver.com` | your Naver password, or an app password if two-step login is on |
| Synology Calendar | **CalDAV** | `https://<nas>:5001/caldav/`: tick "on my home network" | your DSM password |
| Nextcloud · Fastmail · Radicale | **CalDAV** | the CalDAV address from the service's settings | (app) password |

**Several accounts**: add one connection per account (e.g. `personal`, `work`). For Google, press **Add account** on a signed-in connection: it reuses the same Google Cloud app, so you only sign in with the other account; a new Google Tasks or Calendar connection can reuse it too. With several accounts every event line says which account it came from. Each connection is switched off, tested and filtered on its own.

`calendars` limits the connection to some calendars by name (comma separated); empty means all.

Tools: `calendar_list` (accounts and calendars), `calendar_events` (date, days ≤ 62, account). Nothing is written to your calendars.
