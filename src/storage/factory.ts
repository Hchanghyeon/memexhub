import type { Connection, Connections } from "../core/connections.js";
import type { VaultStorage } from "./types.js";
import { WebDavStorage } from "./webdav.js";

/** Factory: connection row → storage strategy. Runtime-specific adapters are injected (fs is Node-only). */
export type StorageBuilders = Record<string, (c: Connection, secrets: Record<string, string>) => VaultStorage>;

export const portableBuilders: StorageBuilders = {
  webdav: (c, s) => new WebDavStorage({ url: String(c.config.url), username: c.config.username as string | undefined, password: s.password }),
};

export async function buildStorage(conns: Connections, name: string | undefined, builders: StorageBuilders): Promise<VaultStorage | undefined> {
  const list = await conns.list("storage");
  const c = (name ? list.find((x) => x.name === name) : list[0]) ?? undefined;
  if (!c || !c.enabled) return undefined;
  const b = builders[c.provider];
  if (!b) throw new Error(`storage provider "${c.provider}" is not available on this runtime`);
  return b(c, await conns.secretsOf(c.id));
}
