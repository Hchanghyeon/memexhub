import type { Hono } from "hono";
import { setFontHref } from "./layout.js";

/** Static files for the admin UI, provided by the runtime entry (Node reads them from disk; Workers has none). */
export interface AdminAssets {
  /** The @font-face CSS with font URLs under `base`. */
  fontCss(base: string): string;
  /** A font file by name, or null. */
  font(name: string): Promise<Uint8Array | null>;
}

/** Public, cacheable routes for the web font. Registered before sign-in so the sign-in page uses it too. */
export function assetRoutes(app: Hono<any>, assets: AdminAssets | undefined, B: string) {
  if (!assets) return;
  setFontHref(`${B}/assets/pretendard.css`);
  const css = assets.fontCss(`${B}/assets/font`);
  app.get("/assets/pretendard.css", (c) => {
    c.header("Cache-Control", "public, max-age=604800");
    return c.body(css, 200, { "content-type": "text/css; charset=utf-8" });
  });
  app.get("/assets/font/:name", async (c) => {
    const name = c.req.param("name");
    const data = /^PretendardVariable\.subset\.\d{1,3}\.woff2$/.test(name) ? await assets.font(name) : null;
    if (!data) return c.text("not found", 404);
    c.header("Cache-Control", "public, max-age=31536000, immutable");
    return c.body(data as unknown as ArrayBuffer, 200, { "content-type": "font/woff2" });
  });
}
