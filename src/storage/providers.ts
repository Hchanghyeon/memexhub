import { z } from "zod";
import { defineProvider } from "../providers/types.js";
import { T } from "../core/i18n.js";
import { WebDavStorage } from "./webdav.js";

export const webdavProvider = defineProvider({
  kind: "storage",
  id: "webdav",
  title: T("WebDAV (Nextcloud, NAS, Remotely Save)", "WebDAV (Nextcloud, NAS, Remotely Save)"),
  config: z.object({
    url: z.string().url().describe("Vault folder URL"),
    username: z.string().optional().describe("Username"),
    allowPrivateNetwork: z.boolean().default(false).describe("Server is on my private network"),
  }),
  secrets: z.object({ password: z.string().optional().describe("Password") }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.url).hostname],
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: ({ config, secrets, fetch }) => new WebDavStorage({ url: config.url, username: config.username, password: secrets.password }, fetch),
  test: async (s) => {
    await s.list();
  },
});
