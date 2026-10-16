/** @jsxImportSource hono/jsx */
import type { Child } from "hono/jsx";

// One accent, neutral grays, red only for errors, green only for ok. Light and dark follow the device.
const css = `:root{--fg:#1d1d1f;--muted:#6b6b72;--line:#e2e2e6;--bg:#f5f5f7;--card:#fff;--accent:#2457c5;--on-accent:#fff;--ok:#1a7f37;--err:#c0262d;--code:#f0f0f3;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--fg:#ececef;--muted:#a1a1aa;--line:#2f2f35;--bg:#121214;--card:#1b1b1f;--accent:#7aa2ff;--on-accent:#0d1530;--ok:#4cc26d;--err:#ff7b7b;--code:#26262b}}
*{box-sizing:border-box}
body{margin:0;font:15px/1.6 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR","Segoe UI",sans-serif;color:var(--fg);background:var(--bg);-webkit-text-size-adjust:100%;word-break:keep-all;overflow-wrap:anywhere}
a{color:var(--accent)}
header.top{position:sticky;top:0;z-index:5;background:var(--card);border-bottom:1px solid var(--line)}
.top-in{max-width:860px;margin:0 auto;padding:.55rem 1rem 0;display:flex;flex-wrap:wrap;align-items:center;gap:.2rem .8rem}
.brand{font-weight:700;color:var(--fg);text-decoration:none;padding:.15rem 0}
.top-in .lang{margin-left:auto;font-size:.85rem;color:var(--muted)}
nav.tabs{flex-basis:100%;display:flex;gap:.1rem;overflow-x:auto;scrollbar-width:none}
nav.tabs::-webkit-scrollbar{display:none}
nav.tabs a{padding:.55rem .65rem;white-space:nowrap;color:var(--muted);text-decoration:none;border-bottom:2px solid transparent;font-size:.93rem}
nav.tabs a[aria-current=page]{color:var(--fg);border-color:var(--accent);font-weight:600}
main{max-width:860px;margin:0 auto;padding:1rem 1rem 4rem}
main.narrow{max-width:460px;padding-top:3rem}
h1{font-size:1.35rem;margin:.6rem 0 1rem;line-height:1.3}
h2{font-size:1.05rem;margin:0 0 .5rem}
h3{font-size:.95rem;margin:1.3rem 0 .3rem}
p{margin:.4rem 0 .8rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:0 0 1rem}
.grid{display:grid;gap:.6rem;grid-template-columns:repeat(auto-fill,minmax(min(100%,190px),1fr));margin:0 0 1rem}
@media (max-width:520px){.grid{grid-template-columns:1fr 1fr}.grid .card{padding:.8rem .85rem}.stat .v{font-size:.95rem}}
.grid .card{margin:0}
.stat{display:block;color:inherit;text-decoration:none}
.stat .k{color:var(--muted);font-size:.85rem}.stat .v{font-weight:600;margin:.15rem 0}.stat .s{color:var(--muted);font-size:.85rem}
a.stat:hover{border-color:var(--accent)}
label{display:block;margin:.8rem 0;font-size:.92rem}
.hint{display:block;color:var(--muted);font-size:.84rem;margin-top:.15rem}
input,select,textarea{display:block;width:100%;padding:.6rem .7rem;margin-top:.3rem;font:inherit;color:var(--fg);background:var(--card);border:1px solid var(--line);border-radius:8px}
textarea{min-height:4.5rem}
label.check{display:flex;gap:.55rem;align-items:flex-start;margin:.55rem 0}
label.check input{width:auto;margin:.3rem 0 0;flex:none}
button,.btn{display:inline-block;padding:.55rem 1rem;margin:.3rem .4rem .3rem 0;font:inherit;font-size:.93rem;line-height:1.3;border-radius:8px;border:1px solid var(--accent);background:var(--accent);color:var(--on-accent);cursor:pointer;text-decoration:none}
button.secondary,.btn.secondary{background:transparent;color:var(--fg);border-color:var(--line)}
button.danger{background:transparent;color:var(--err);border-color:var(--err)}
button.small{padding:.3rem .65rem;font-size:.85rem;margin:.1rem .3rem .1rem 0}
.ok{color:var(--ok)}.err{color:var(--err)}.muted{color:var(--muted);font-size:.9rem}
.flash{padding:.7rem .9rem;border-radius:10px;margin:0 0 1rem;background:var(--card);border:1px solid var(--line);border-left:4px solid var(--ok)}
.flash.err{border-left-color:var(--err)}
.tw{overflow-x:auto;margin:0 -.2rem}
table{border-collapse:collapse;width:100%}
td,th{border-bottom:1px solid var(--line);padding:.55rem .4rem;text-align:left;font-size:.9rem;vertical-align:top}
th{color:var(--muted);font-weight:500;font-size:.84rem}
tr:last-child td{border-bottom:0}
code,pre{background:var(--code);border-radius:6px;padding:.1rem .35rem;font-size:.87em}
pre{padding:.7rem .8rem;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
ul.list{list-style:none;padding:0;margin:0}
ul.list li{padding:.5rem 0;border-bottom:1px solid var(--line);display:flex;gap:.5rem;align-items:baseline}
ul.list li:last-child{border-bottom:0}
.row{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center}
form.inline{display:inline}
.dot{display:inline-block;width:.55rem;height:.55rem;border-radius:50%;margin-right:.4rem;background:var(--muted);flex:none}
.dot.ok{background:var(--ok)}.dot.err{background:var(--err)}
.tag{display:inline-block;font-size:.78rem;padding:.05rem .45rem;border:1px solid var(--line);border-radius:99px;color:var(--muted);margin:.1rem .2rem .1rem 0}
details{margin:.6rem 0}summary{cursor:pointer;color:var(--accent)}
.vf{display:none}
form:has(option[value=builtin]:checked) .vf-builtin,form:has(option[value=folder]:checked) .vf-folder,form:has(option[value=webdav]:checked) .vf-webdav,form:has(option[value=notion]:checked) .vf-notion,form:has(option[value=r2]:checked) .vf-r2{display:block}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px}`;

/**
 * Page frame. With `nav` it is the signed-in app (sticky header with tabs that scroll sideways on a phone);
 * without it a narrow centred page (sign-in, setup, consent).
 */
export function Layout(p: { title: string; children: Child; lang?: "en" | "ko"; nav?: Child; flash?: { ok?: string; err?: string } }) {
  return (
    <html lang={p.lang ?? "en"}>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
        <meta name="robots" content="noindex" />
        <meta name="theme-color" content="#2457c5" />
        <title>{p.title}</title>
        <style>{css}</style>
      </head>
      <body>
        {p.nav}
        <main class={p.nav ? "" : "narrow"}>
          {p.flash?.ok && <p class="flash" role="status">{p.flash.ok}</p>}
          {p.flash?.err && <p class="flash err" role="alert">{p.flash.err}</p>}
          {p.children}
        </main>
      </body>
    </html>
  );
}
