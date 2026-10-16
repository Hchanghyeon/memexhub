import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The admin web app. Served by the server under /admin (Node: dist-web/, Workers: static assets).
export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  base: "/admin/",
  plugins: [react()],
  build: { outDir: fileURLToPath(new URL("../dist-web", import.meta.url)), emptyOutDir: true, assetsInlineLimit: 0, sourcemap: false },
  server: { proxy: { "/admin/api": "http://localhost:8787" } },
});
