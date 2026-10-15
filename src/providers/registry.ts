import type { ProviderDef } from "./types.js";
import { webdavProvider } from "../storage/providers.js";

/** Portable providers (Node and Workers). Runtime-specific ones are added by the entry point. */
export const PORTABLE_PROVIDERS: ProviderDef[] = [webdavProvider];
