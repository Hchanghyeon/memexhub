import { readFileSync } from "node:fs";

/**
 * Where boot settings come from besides the environment:
 * - Home Assistant add-ons get their options in /data/options.json;
 * - platforms that hand out one port (Railway, Render) set PORT.
 * Real environment variables always win.
 */
export function bootEnv(env: NodeJS.ProcessEnv, optionsFile = "/data/options.json"): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  try {
    const o = JSON.parse(readFileSync(optionsFile, "utf8")) as Record<string, unknown>;
    const map: Record<string, string> = { memexhub_secret: "MEMEXHUB_SECRET", public_url: "PUBLIC_URL", timezone: "TZ", admin_public: "ADMIN_PUBLIC" };
    for (const [k, v] of Object.entries(map)) if (o[k] !== undefined && o[k] !== "" && o[k] !== null) out[v] = String(o[k]);
  } catch {
    /* not an add-on */
  }
  if (env.PORT && !env.SINGLE_PORT) Object.assign(out, { LISTEN: env.LISTEN ?? "single", SINGLE_PORT: env.PORT });
  return { ...out, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== "")) };
}
