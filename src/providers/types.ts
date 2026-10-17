import type { z } from "zod";
import type { Text } from "../core/i18n.js";
import type { Platform } from "../platform/types.js";
import type { VaultStorage } from "../storage/types.js";
import type { Geocoder, LocationProvider } from "./location/types.js";

/** What each kind of provider must implement. Extended as kinds are added (mail, location, …). */
export interface KindMap {
  storage: VaultStorage;
  location: LocationProvider;
  geocoder: Geocoder;
  [kind: string]: unknown;
}

export interface ProviderContext<C, S> {
  config: C;
  secrets: S;
  /** Outbound HTTP limited to this connection's hosts (see guarded-fetch). Providers must use it. */
  fetch: typeof fetch;
  platform: Platform;
  /** IANA time zone from settings. */
  timezone: string;
  connection: { id: string; name: string };
  /** Store changed secrets of this connection (a service that rotates its refresh token). */
  saveSecrets(patch: Record<string, string>): Promise<void>;
}

/** Plugin contract for an external service. Adding one = a file + one line in the registry. */
export interface ProviderDef<K extends string = string, C = any, S = any> {
  kind: K;
  id: string;
  title: Text;
  /** Visible settings. Field `.describe()` texts become form labels. */
  config: z.ZodObject<any>;
  /** Write-only secrets, stored encrypted. */
  secrets?: z.ZodObject<any>;
  runtimes: ("node" | "workers")[];
  /** Hosts this connection may call, derived from its config (e.g. the URL field). */
  hosts?(config: C): string[];
  /** May this connection reach private-network addresses (e.g. a server on your LAN)? */
  allowPrivate?(config: C): boolean;
  create(ctx: ProviderContext<C, S>): KindMap[K] | Promise<KindMap[K]>;
  test?(instance: KindMap[K]): Promise<void>;
  /**
   * Values a config field can be picked from, read from the connected service (e.g. Home Assistant entities).
   * Offered in the admin form once the connection is saved; the picked values are written into the field.
   */
  choices?: Record<string, (instance: any) => Promise<Choice[]>>;
}

/** One pickable value: `group` sorts them (a device type), `note` shows the current state or a detail. */
export interface Choice { value: string; label: string; group?: string; note?: string }

export const defineProvider = <K extends string>(p: ProviderDef<K, any, any>) => p;
