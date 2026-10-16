import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 8799);
// Low-memory flags: containers often have a tiny /dev/shm, where Chrome otherwise hangs.
const launchOptions = { args: ["--disable-dev-shm-usage", "--disable-gpu"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) };

export default defineConfig({
  testDir: "e2e",
  workers: 1,
  timeout: 30_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: { baseURL: `http://127.0.0.1:${port}`, locale: "ko-KR", trace: "retain-on-failure", launchOptions },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 860 }, launchOptions } },
    { name: "phone", use: { ...devices["Pixel 7"], launchOptions } },
  ],
  webServer: { command: "npx tsx e2e/server.ts", url: `http://127.0.0.1:${port}/admin/`, reuseExistingServer: !process.env.CI, timeout: 60_000, env: { E2E_PORT: String(port) } },
});
