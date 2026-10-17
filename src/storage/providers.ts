import { z } from "zod";
import { defineProvider } from "../providers/types.js";
import { F, T } from "../core/i18n.js";
import { WebDavStorage } from "./webdav.js";
import { S3Storage } from "./s3.js";

export const webdavProvider = defineProvider({
  kind: "storage",
  id: "webdav",
  title: T("WebDAV (Nextcloud, NAS, Remotely Save)", "WebDAV (Nextcloud, NAS, Remotely Save)"),
  config: z.object({
    url: z.string().url().meta(F("Vault folder address", "볼트 폴더 주소", ["The WebDAV address of the vault folder, e.g. https://nas.example.com:5006/vault/", "볼트 폴더의 WebDAV 주소예요. 예: https://nas.example.com:5006/vault/"])),
    username: z.string().optional().meta(F("Username", "아이디")),
    allowPrivateNetwork: z.boolean().default(false).meta(F("The server is on my home network", "서버가 집 네트워크 안에 있어요", ["Tick when the address is a home address such as 192.168.x.x or http://nas.local. Leave it off for internet addresses.", "주소가 192.168.x.x, http://nas.local 처럼 집 안 주소면 체크하세요. 인터넷 주소면 끈 채로 두세요."])),
  }),
  secrets: z.object({ password: z.string().optional().meta(F("Password", "비밀번호")) }),
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
    endpoint: z.string().url().meta(F("Endpoint", "엔드포인트", ["R2: https://<account id>.r2.cloudflarestorage.com · MinIO: your MinIO address.", "R2: https://<계정 id>.r2.cloudflarestorage.com · MinIO: MinIO 주소."])),
    region: z.string().max(40).default("auto").meta(F("Region", "리전", ["auto for R2; your bucket's region for S3.", "R2는 auto, S3는 버킷의 리전이에요."])),
    bucket: z.string().min(3).max(63).meta(F("Bucket", "버킷")),
    prefix: z.string().max(200).optional().meta(F("Folder inside the bucket (optional)", "버킷 안의 폴더 (선택)", ["Empty: the whole bucket is the vault.", "비우면 버킷 전체가 볼트예요."])),
    accessKeyId: z.string().min(1).max(200).meta(F("Access key ID", "액세스 키 ID")),
    allowPrivateNetwork: z.boolean().default(false).meta(F("The server is on my home network (MinIO)", "서버가 집 네트워크 안에 있어요 (MinIO)")),
  }),
  secrets: z.object({ secretAccessKey: z.string().min(1).meta(F("Secret access key", "시크릿 액세스 키")) }),
  runtimes: ["node", "workers"],
  hosts: (c: any) => [new URL(c.endpoint).hostname],
  allowPrivate: (c: any) => !!c.allowPrivateNetwork,
  create: ({ config, secrets, fetch }) => new S3Storage({ ...config, secretAccessKey: secrets.secretAccessKey }, fetch),
  test: async (s) => {
    await s.list();
  },
});
