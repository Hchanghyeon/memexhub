# Wiki engine

> Sources stay untouched. The LLM maintains wiki pages. The engine keeps indexes, links and rules in order.
> — the LLM Wiki pattern (after Andrej Karpathy)

## Vocabulary

| Term | Meaning |
|---|---|
| Vault | Your whole Obsidian folder: your notes, automatic logs, the wiki layer, rule notes |
| LLM Wiki | The goal. Narrowly: the wiki layer — sources → LLM-written pages → index & log |
| Source | Never edited. Articles you saved — and your own life logs can be sources too (e.g. weekly reviews → a page about your spending habits) |
| Engine | memexhub |

## Roles, not folders 📝

The engine knows roles. You map them to your vault in the admin UI.

| Role | Meaning | Karpathy-style | PARA example |
|---|---|---|---|
| `sources` | immutable originals | `raw/` | `Resources/Sources/` |
| `wiki` | LLM-maintained pages | `wiki/` | `Resources/Wiki/` |
| `index` | how indexes work | `index.md` | folder notes |
| `log` | wiki change log | `log.md` | `Resources/Wiki/log.md` |
| `daily` | daily notes | — | `Journal/YYYY-MM-DD` |
| `logs` | automatic log notes | — | `Journal/payments/{year}` |
| `rules` | rule notes, protected from tools | `CLAUDE.md` | `CLAUDE.md`, routine notes |
| `archive`, `trash` | archive and trash | — | `Archive/`, `.trash/` |

- An empty role switches the related feature off.
- **Presets** fill the roles in one click: `llm-wiki`, `para`, `para-ko`, `zettelkasten`, `flat`.
- Empty vault → scaffold folders and rule notes from the preset. Existing vault → the engine suggests roles, you confirm.
- The mapping can be exported as a human-readable rules note (a protected path) so Claude reads the same rules.

## Wiki module 📝

| Tool | Does | Why the engine |
|---|---|---|
| `wiki_lint` | broken links, orphans, missing index entries, oversized pages, unregistered tags, missing frontmatter, wiki claims without a source link | exact checks, no tokens |
| `wiki_save_source` | store an original in `sources` unchanged, add frontmatter | guarantees "never edit sources" |
| `wiki_index` | add/sort index lines, split an index when it grows too long | mechanical upkeep |
| `wiki_backlinks(path)` | notes linking to a note | context for Claude |
| `wiki_log` | append one line to the wiki log | append-only rule |

Every lint rule can be toggled. Your conventions (required frontmatter keys, registered tags, page size, index length) are just rules you switch on.

Summaries, concept pages and contradiction judgements stay with Claude: *"collect this"*, *"find it in the wiki"*, *"lint the wiki"*.
