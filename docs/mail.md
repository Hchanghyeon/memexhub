# Mail ✅

Read-only access to your mailboxes over IMAP, for Claude (`mail_*` tools), for the day summary (counts only) and for receipt mails ([recipes](recipes.md#mail-)). Several accounts work side by side.

## Connect

Admin UI → Connections → *Mail (IMAP)*: a name (e.g. `personal`), the service and your username.

| Service | Password | Notes |
|---|---|---|
| Kakao | the account password, or an app password if 2-step verification is on | enable IMAP in Kakao Mail settings |
| Naver | an **app password** (Naver ID → Security) | enable IMAP in Naver Mail settings |
| Gmail | an **app password** (Google Account → Security → 2-Step → App passwords) | |
| Outlook | an app password, if your account allows IMAP with one | some organisations disable IMAP |
| custom | IMAP host and port; TLS required (plain IMAP only on your private network) | |

## Safety

- **Read-only by construction**: the client can only send `CAPABILITY LOGIN LIST EXAMINE UID SEARCH UID FETCH LOGOUT NOOP`. Mailboxes are opened with `EXAMINE` and bodies fetched with `BODY.PEEK`, so nothing is ever marked read, moved or deleted. There is **no send tool**.
- Mail content returned to Claude is marked **untrusted**, links are replaced with `[link]`, attachments are never opened (names only), length is capped.
- The password is stored encrypted and is never shown again.

## Tools

| Tool | Does |
|---|---|
| `mail_folders(account?)` | folders |
| `mail_search(account?, folder, since, until?, query?, from?)` | matching mails: date, sender, subject |
| `mail_read(account?, folder, uid)` | one mail as text (up to 8000 characters) |
| `mail_day(account?, date?)` | one day for a daily note: received / sent with a short preview, other folders subject only |
