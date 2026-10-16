import type { ProviderDef } from "./types.js";
import { s3Provider, webdavProvider } from "../storage/providers.js";
import { dawarichProvider } from "./location/dawarich.js";
import { owntracksProvider } from "./location/owntracks.js";
import { nominatimProvider } from "./geocoder/nominatim.js";
import { googleTasksProvider } from "./tasks/google.js";
import { notionProvider } from "./notion/client.js";
import { notionVaultProvider } from "./notion/vault.js";
import { openMeteoProvider } from "./weather/open-meteo.js";
import { caldavProvider, icloudCalendarProvider } from "./calendar/caldav.js";
import { googleCalendarProvider } from "./calendar/google.js";

/** Portable providers (Node and Workers). Runtime-specific ones are added by the entry point. */
export const PORTABLE_PROVIDERS: ProviderDef[] = [webdavProvider, s3Provider, dawarichProvider, owntracksProvider, nominatimProvider, googleTasksProvider, notionProvider, notionVaultProvider, openMeteoProvider, caldavProvider, icloudCalendarProvider, googleCalendarProvider];
