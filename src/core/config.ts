import { z } from "zod";

/** Only what is needed to boot. Everything else lives in the settings table and is edited in the admin UI. */
export const EnvSchema = z.object({
  MEMEXHUB_SECRET: z
    .string()
    .min(32, "MEMEXHUB_SECRET must be at least 32 characters (use: openssl rand -base64 48)"),
  PUBLIC_URL: z
    .string()
    .url()
    .refine((u) => u.startsWith("https://") || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/.test(u), {
      message: "PUBLIC_URL must be https:// (http is only allowed for localhost)",
    })
    .transform((u) => u.replace(/\/+$/, "")),
  DATA_DIR: z.string().min(1).default("./data"),
  LISTEN: z.enum(["split", "single"]).default("split"),
  MCP_PORT: z.coerce.number().int().default(8787),
  INGEST_PORT: z.coerce.number().int().default(8790),
  ADMIN_PORT: z.coerce.number().int().default(8791),
  SINGLE_PORT: z.coerce.number().int().default(8787),
  TZ: z.string().default("UTC"),
  /** The admin UI is only reachable over the internet (Railway, Render …): allow it, with two-factor enforced. */
  ADMIN_PUBLIC: z.enum(["0", "1", "true", "false"]).default("0").transform((v) => v === "1" || v === "true"),
  /** Folders the admin UI may choose as a server-local vault (security boundary). The built-in vault lives in DATA_DIR/vault. */
  VAULT_ROOTS: z.string().default("/vaults"),
  /** Comma-separated CIDRs whose X-Real-IP / X-Forwarded-For we trust (your reverse proxy). Default: private ranges. */
  TRUSTED_PROXIES: z.string().default("127.0.0.0/8,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,::1/128,fc00::/7"),
});
export type Env = z.infer<typeof EnvSchema>;

export function loadEnv(src: Record<string, string | undefined>): Env {
  const r = EnvSchema.safeParse(src);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  if (/^(change-?me|secret|password|test)/i.test(r.data.MEMEXHUB_SECRET)) {
    throw new Error("MEMEXHUB_SECRET looks like a placeholder. Generate one: openssl rand -base64 48");
  }
  return r.data;
}
