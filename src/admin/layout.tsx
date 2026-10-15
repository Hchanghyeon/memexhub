/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";

const css = `body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:2rem auto;padding:0 1rem;color:#222}
h1{font-size:1.4rem}label{display:block;margin:.6rem 0}input,select{display:block;width:100%;padding:.5rem;margin-top:.2rem;box-sizing:border-box}
button{padding:.5rem 1rem;margin-right:.5rem;cursor:pointer}.secondary{background:#eee}.err{color:#b00}.ok{color:#070}.muted{color:#666}
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
