import { z } from "zod";
import { defineProvider } from "../providers/types.js";
import { T } from "../core/i18n.js";
import { WebDavStorage } from "./webdav.js";
import { S3Storage } from "./s3.js";

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

export const s3Provider = defineProvider({
  kind: "storage",
  id: "s3",
  title: T("S3 / Cloudflare R2 / MinIO", "S3 / Cloudflare R2 / MinIO"),
  config: z.object({
    endpoint: z.string().url().describe("Endpoint, e.g. https://<account>.r2.cloudflarestorage.com"),
    region: z.string().max(40).default("auto").describe("Region (auto for R2)"),
    bucket: z.string().min(3).max(63).describe("Bucket"),
    prefix: z.string().max(200).optional().describe("Folder inside the bucket (optional)"),
    accessKeyId: z.string().min(1).max(200).describe("Access key ID"),
    allowPrivateNetwork: z.boolean().default(false).describe("Server is on my private network (MinIO)"),
  }),
  secrets: z.object({ secretAccessKey: z.string().min(1).describe("Secret access key") }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.endpoint).hostname],
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: ({ config, secrets, fetch }) => new S3Storage({ ...config, secretAccessKey: secrets.secretAccessKey }, fetch),
  test: async (s) => {
    await s.list();
  },
});
