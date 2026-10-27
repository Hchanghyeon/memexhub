// Screens use tokens, not literals: no colors, font sizes or text styles outside ui/theme.
// A line that truly needs one ends with `// token-ok: <reason>`.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(root, "android/app/src/main/kotlin");
const rules = [
  [/\bColor\(0x/, "color literal: use Mx.colors"],
  [/\bColor\.(White|Black|Red|Blue|Green|Gray|LightGray|DarkGray|Yellow|Cyan|Magenta)\b/, "named color: use Mx.colors"],
  [/\b\d+(\.\d+)?\.sp\b/, "font size literal: use MxType"],
  [/\bTextStyle\(/, "text style: use MxType"],
];
const files = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : [join(d, f)]));
let bad = 0;
for (const f of files(src).filter((f) => f.endsWith(".kt") && !f.includes("/ui/theme/"))) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (line.includes("token-ok:")) return;
    for (const [re, why] of rules) if (re.test(line)) { console.error(`${relative(root, f)}:${i + 1}: ${why}\n    ${line.trim()}`); bad++; }
  });
}
if (bad) console.error(`\n${bad} literal(s) outside the tokens. See design/README.md.`);
process.exit(bad ? 1 : 0);
