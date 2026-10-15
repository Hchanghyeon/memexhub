import type { ProviderDef } from "./types.js";
import { webdavProvider } from "../storage/providers.js";
import { dawarichProvider } from "./location/dawarich.js";
import { owntracksProvider } from "./location/owntracks.js";
import { nominatimProvider } from "./geocoder/nominatim.js";

/** Portable providers (Node and Workers). Runtime-specific ones are added by the entry point. */
export const PORTABLE_PROVIDERS: ProviderDef[] = [webdavProvider, dawarichProvider, owntracksProvider, nominatimProvider];
