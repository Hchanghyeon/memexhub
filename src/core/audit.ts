import type { Db } from "../platform/types.js";

/** Never put note content, secrets or personal values in `detail` — sizes, hashes and ids only. */
export async function audit(db: Db, actor: string, action: string, target?: string, detail?: Record<string, unknown>) {
  await db.run(`INSERT INTO audit (at, actor, action, target, detail) VALUES (?, ?, ?, ?, ?)`, [
    new Date().toISOString(),
    actor,
    action,
    target ?? null,
    detail ? JSON.stringify(detail) : null,
  ]);
}
