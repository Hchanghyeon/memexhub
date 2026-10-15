import type { ModuleDef } from "../core/registry.js";
import vault from "./vault/index.js";
import hub from "./hub/index.js";

/** Plugin registry. Adding a module = one line here. */
export const MODULES: ModuleDef[] = [vault, hub];
