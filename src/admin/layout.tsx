/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";

const css = `body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#222}
h1{font-size:1.4rem}label{display:block;margin:.6rem 0}input,select,textarea{display:block;width:100%;padding:.5rem;margin-top:.2rem;box-sizing:border-box;font:inherit}
button{padding:.5rem 1rem;margin:.2rem .5rem .2rem 0;cursor:pointer;font:inherit;border-radius:6px;border:1px solid #1f5fbf;background:#1f5fbf;color:#fff}
button.secondary{background:#f3f3f3;color:#222;border-color:#ccc}button.danger{background:#fff;color:#b00;border-color:#b00}button:focus-visible,a:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid #1f5fbf;outline-offset:2px}.err{color:#b00}.ok{color:#070}.muted{color:#666}
table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:.3rem;text-align:left;font-size:.9rem}
code,pre{background:#f4f4f4;padding:.1rem .3rem}.card{border:1px solid #ddd;border-radius:6px;padding:1rem;margin:1rem 0}nav a{margin-right:1rem}`;

export function Layout(p: { title: string; children: Child }) {
  return (
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{p.title}</title>
        <style>{css}</style>
      </head>
      <body>{p.children}</body>
    </html>
  );
}
