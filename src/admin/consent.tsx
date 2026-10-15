/** @jsxImportSource hono/jsx */
import { Layout } from "./layout.js";

export function consentPage(p: {
  v: { clientName: string; redirectHost: string };
  query: string;
  error?: string;
  needTotp: boolean;
}) {
  return (
    <Layout title="Authorize · memexhub">
      <h1>Connect to memexhub</h1>
      <p>
        <b>{p.v.clientName}</b> wants to use your memexhub tools. After approval you will be sent back to{" "}
        <code>{p.v.redirectHost}</code>.
      </p>
      <p class="muted">Only approve if you just added memexhub as a connector yourself.</p>
      {p.error && <p class="err">{p.error}</p>}
      <form method="post" action="/authorize">
        <input type="hidden" name="query" value={p.query} />
        <label>Admin username<input name="username" autocomplete="username" required /></label>
        <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
        <label>Authenticator code (if enabled)<input name="totp" inputmode="numeric" autocomplete="one-time-code" /></label>
        <div class="row">
          <button name="decision" value="allow" type="submit">Allow</button>
          <button name="decision" value="deny" type="submit" class="secondary">Deny</button>
        </div>
      </form>
    </Layout>
  );
}
