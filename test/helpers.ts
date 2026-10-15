import { z } from "zod";
import { defineProvider } from "../src/providers/types.js";
import { T } from "../src/core/i18n.js";
import { FsStorage } from "../src/storage/fs.js";

/** A storage provider pinned to a temp folder, for tests. */
export const testFs = (root: string) =>
  defineProvider({ kind: "storage", id: "fs", title: T("test", "test"), config: z.object({ path: z.string().optional() }), runtimes: ["node"], create: () => new FsStorage(root) });
