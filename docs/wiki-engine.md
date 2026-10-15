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

## Roles, not folders ✅

The engine knows roles. Map them in the admin UI (*Wiki layout*) or pick a preset.

| Role | Meaning | Effect |
|---|---|---|
| `sources` | immutable originals | **write-once**: tools can create notes here but never edit, append, move or trash them |
| `wiki` | LLM-maintained pages (`""` = whole vault) | scope of orphan / index / size / source checks |
| `index` | `folder-note` (index of `X/` is `X/X.md`), `index-file` (`X/index.md`), or `none` | `wiki_index`, `missing-index-entry` |
| `log` | wiki change log note | `wiki_log` |
| `daily` | daily note pattern, e.g. `Journal/{YYYY-MM-DD}.md` | used by later modules |
| `rules` | globs of rule notes | **protected**: tools can never write them |
| `archive` | archive folder | used by later modules |

An empty role switches the related feature off (its tools are not shown to Claude).

### Presets

| Preset | sources | wiki | index | log |
|---|---|---|---|---|
| `llm-wiki` | `raw` | `wiki` | `index.md` | `wiki/log.md` |
| `para` | `Resources/Sources` | `Resources/Wiki` | folder note | `Resources/Wiki/log.md` |
| `para-ko` | `30-자료/원본` | `30-자료/위키` | folder note | `30-자료/위키/로그.md` |
| `zettelkasten` | `sources` | whole vault | none | — |
| `flat` | — | whole vault | none | — |

## Tools

| Tool | Does | Shown when |
|---|---|---|
| `wiki_layout` ✅ | describes roles and enabled lint rules — Claude calls it before filing notes | always |
| `wiki_lint` ✅ | runs the lint rules, findings grouped by rule | always |
| `wiki_save_source` ✅ | stores an original as `<sources>/YYYY-MM-DD title.md`, body unchanged, frontmatter added/merged, never overwrites | `sources` set |
| `wiki_log` ✅ | appends `- YYYY-MM-DD entry` to the log | `log` set |
| `wiki_index` ✅ | adds `- [[page]] — description` to the page's index, once, optionally under `## section` | index style ≠ `none` |
| `wiki_backlinks` ✅ | notes linking to a note, with the line | always |

## Lint rules ✅

| Rule | Default | Options | Finds |
|---|---|---|---|
| `broken-links` | on | `ignore` (globs) | `[[links]]` that resolve to nothing (code is ignored; attachments count) |
| `orphans` | on | — | wiki pages no other note links to |
| `missing-index-entry` | on | — | wiki pages not listed in their index (or the index note is missing) |
| `oversized-pages` | on | `maxBytes` (4096) | wiki pages to split |
| `index-too-long` | on | `maxEntries` (50) | indexes to split into sub-indexes |
| `frontmatter-required` | off | `keys`, `scope` (`wiki` / `all`) | notes missing required keys |
| `unregistered-tags` | off | `allowed` | tags not in your registry |
| `wiki-page-without-source` | off | — | wiki pages that cite no source note |
| `bad-filenames` | on | — | names with `[ ] # ^ \| : ? * " < > \` |

Links resolve like Obsidian: exact path → path relative to the linking note → basename (nearest folder first).

## Talking to Claude

- *"Save this article as a source and update the wiki."* → `wiki_layout` → `wiki_save_source` → write/update pages with `write_note` → `wiki_index` → `wiki_log`
- *"Lint the wiki and tell me what to fix."* → `wiki_lint` → Claude reports, you choose, Claude fixes
- *"What links to the Redis page?"* → `wiki_backlinks`

Summaries, concept pages and contradiction judgements stay with Claude; the engine does exact upkeep.
