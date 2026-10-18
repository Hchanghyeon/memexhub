# Calendar

memexhub reads your calendars (read-only) so Claude sees your day in `day_summary` and can answer "what is on Friday?" with `calendar_events`. Recurring events are expanded by the server.

| Service | Connection | Address | Password |
|---|---|---|---|
| Google | **Google Calendar** → *Sign in with Google* | (fixed) | an OAuth client from Google Cloud (Web application) with the Google Calendar API on; only read-only access is asked |
| iCloud | **iCloud Calendar** | (fixed) | an app-specific password from appleid.apple.com → Sign-In and Security |
| Naver | **CalDAV** | `https://caldav.calendar.naver.com` | your Naver password, or an app password if two-step login is on |
| Synology Calendar | **CalDAV** | `https://<nas>:5001/caldav/`: tick "on my home network" | your DSM password |
| Nextcloud · Fastmail · Radicale | **CalDAV** | the CalDAV address from the service's settings | (app) password |
| Any calendar (no sign-in) | **Calendar link (iCal)** | the calendar's iCal link (`webcal://` works) | none: the link itself is the secret, stored encrypted |

**By link, no sign-in ✅**: in Google Calendar open the calendar's settings → **Integrate calendar → Secret address in iCal format**; in iCloud share the calendar publicly and copy its link. One connection per calendar. memexhub expands recurring events itself (daily, weekly, monthly, yearly, counts and end dates, "second Monday", skipped and moved occurrences). Google refreshes these feeds every few hours, so a new event can show late; use Google sign-in when that matters.

**Several accounts**: add one connection per account (e.g. `personal`, `work`). For Google, press **Add account** on a signed-in connection: it reuses the same Google Cloud app, so you only sign in with the other account; a new Google Tasks or Calendar connection can reuse it too. With several accounts every event line says which account it came from. Each connection is switched off, tested and filtered on its own.

`calendars` limits the connection to some calendars by name (comma separated); empty means all.

Tools: `calendar_list` (accounts and calendars), `calendar_events` (date, days ≤ 62, account). Nothing is written to your calendars.
