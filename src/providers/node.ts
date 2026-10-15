import type { ProviderDef } from "./types.js";
import { imapProvider } from "./mail/imap.js";

/** Providers that need Node (raw TCP / TLS sockets). */
export const NODE_PROVIDERS: ProviderDef[] = [imapProvider];
