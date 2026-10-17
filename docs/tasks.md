# Tasks ✅

Your to-do lists (Google Tasks) as Claude tools. Several accounts work side by side ("personal", "work"); every tool takes `account`.

## Connect a Google account

1. Google Cloud Console → a project → **APIs & Services**: enable the **Google Tasks API**.
2. **OAuth consent screen**: External (or Internal for Workspace), add yourself as a test user.
3. **Credentials → Create OAuth client → Web application**. Authorized redirect URI: `PUBLIC_URL/oauth/google/callback` (the admin UI shows the exact value).
4. memexhub admin → Connections → *Google Tasks*: a name (e.g. `personal`), client ID, client secret → Save.
5. Press **Sign in with Google** next to the connection and choose the account. Repeat 4–5 for more accounts (they can share the same client).

Security: authorization code + PKCE, a one-time `state` that expires in 10 minutes, minimal scopes (`tasks`, plus `openid email` to show which account it is). The refresh token is stored encrypted and never shown. Revoke it any time in your Google Account → Security → Third-party access.

## Tools

| Tool | Does |
|---|---|
| `tasks_accounts` | connected accounts |
| `tasklists(account)` | lists of an account |
| `tasks_list(account, tasklist?, show_completed?, limit?)` | tasks, open first by due date |
| `task_add(account, title, notes?, due?, tasklist?)` | add (due is a date: Google Tasks keeps no time) |
| `task_update(account, task_id, title?, notes?, due?)` | change; `due: "none"` removes the date |
| `task_complete(account, task_id, undo?)` | mark done or reopen |
| `task_delete(account, task_id)` | **destructive: hidden** unless enabled in settings |
