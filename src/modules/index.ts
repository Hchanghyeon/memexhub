import type { ModuleDef } from "../core/registry.js";
import vault from "./vault/index.js";
import hub from "./hub/index.js";
import wiki from "./wiki/index.js";
import ledger from "./ledger/index.js";

/** Plugin registry. Adding a module = one line here. */
export const MODULES: ModuleDef[] = [vault, wiki, ledger, hub];
