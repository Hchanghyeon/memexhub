import type { ModuleDef } from "../core/registry.js";
import vault from "./vault/index.js";
import hub from "./hub/index.js";
import wiki from "./wiki/index.js";
import ledger from "./ledger/index.js";
import mail from "./mail/index.js";
import location from "./location/index.js";
import health from "./health/index.js";
import meals from "./meals/index.js";
import tasks from "./tasks/index.js";
import notion from "./notion/index.js";
import weather from "./weather/index.js";
import calendar from "./calendar/index.js";
import home from "./home/index.js";
import music from "./music/index.js";

/** Plugin registry. Adding a module = one line here. */
export const MODULES: ModuleDef[] = [vault, wiki, ledger, mail, location, health, meals, tasks, calendar, notion, weather, home, music, hub];
