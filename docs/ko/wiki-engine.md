# 위키 엔진

> 원본은 고치지 않는다. 위키 페이지는 LLM이 다듬는다. 목차·링크·규칙은 엔진이 정리한다.
> — LLM Wiki 패턴 (Andrej Karpathy)

## 용어

| 말 | 뜻 |
|---|---|
| 볼트 | Obsidian 폴더 전체. 내 노트, 자동 기록, 위키 층, 규칙 노트 |
| LLM Wiki | 목표. 좁게는 위키 층 — 원본 → LLM이 쓰는 페이지 → 목차와 로그 |
| 원본 | 고치지 않는 출처. 저장한 글, 그리고 **내 생활 기록도** 원본이 될 수 있어요 (주간 회고 → "내 소비 패턴" 페이지) |
| 엔진 | memexhub |

## 폴더가 아니라 역할 ✅

엔진은 역할만 알아요. 관리 화면(*Wiki layout*)에서 연결하거나 프리셋을 골라요.

| 역할 | 뜻 | 효과 |
|---|---|---|
| `sources` | 고치지 않는 원본 | **한 번만 쓰기**: 도구는 여기에 새 노트를 만들 수만 있고 고치기·덧붙이기·옮기기·휴지통은 못 해요 |
| `wiki` | LLM이 다듬는 페이지 (`""` = 볼트 전체) | 고아·목차·크기·출처 검사의 범위 |
| `index` | `folder-note` (`X/`의 목차는 `X/X.md`), `index-file` (`X/index.md`), `none` | `wiki_index`, `missing-index-entry` |
| `log` | 위키 작업 로그 노트 | `wiki_log` |
| `daily` | 일지 경로 패턴, 예 `Journal/{YYYY-MM-DD}.md` | 이후 모듈에서 사용 |
| `rules` | 규칙 노트 glob | **보호**: 도구로는 절대 못 써요 |
| `archive` | 보관 폴더 | 이후 모듈에서 사용 |

역할을 비우면 그 기능이 꺼지고, 관련 도구도 Claude에게 안 보여요.

### 프리셋

| 프리셋 | 원본 | 위키 | 목차 | 로그 |
|---|---|---|---|---|
| `llm-wiki` | `raw` | `wiki` | `index.md` | `wiki/log.md` |
| `para` | `Resources/Sources` | `Resources/Wiki` | 폴더 노트 | `Resources/Wiki/log.md` |
| `para-ko` | `30-자료/원본` | `30-자료/위키` | 폴더 노트 | `30-자료/위키/로그.md` |
| `zettelkasten` | `sources` | 볼트 전체 | 없음 | — |
| `flat` | — | 볼트 전체 | 없음 | — |

## 도구

| 도구 | 하는 일 | 보이는 조건 |
|---|---|---|
| `wiki_layout` ✅ | 역할과 켜진 점검 규칙을 알려 줘요. Claude가 노트를 넣기 전에 불러요 | 항상 |
| `wiki_lint` ✅ | 점검 규칙을 돌리고 규칙별로 묶어 보여 줘요 | 항상 |
| `wiki_save_source` ✅ | 원본을 `<원본>/YYYY-MM-DD 제목.md`로 저장. 본문은 그대로, 프론트매터만 추가·병합, 덮어쓰기 없음 | `sources` 설정 시 |
| `wiki_log` ✅ | 로그에 `- YYYY-MM-DD 내용` 한 줄 추가 | `log` 설정 시 |
| `wiki_index` ✅ | 페이지를 목차에 `- [[페이지]] — 설명`으로 한 번만, `## 섹션` 아래에도 | 목차 방식 ≠ `none` |
| `wiki_backlinks` ✅ | 이 노트를 가리키는 노트와 그 줄 | 항상 |

## 점검 규칙 ✅

| 규칙 | 기본 | 옵션 | 찾는 것 |
|---|---|---|---|
| `broken-links` | 켬 | `ignore` (glob) | 아무것도 가리키지 않는 `[[링크]]` (코드 안은 무시, 첨부 파일은 인정) |
| `orphans` | 켬 | — | 다른 노트가 아무도 링크하지 않는 위키 페이지 |
| `missing-index-entry` | 켬 | — | 목차에 없는 위키 페이지 (목차 노트가 없어도) |
| `oversized-pages` | 켬 | `maxBytes` (4096) | 쪼갤 위키 페이지 |
| `index-too-long` | 켬 | `maxEntries` (50) | 하위 목차로 쪼갤 목차 |
| `frontmatter-required` | 끔 | `keys`, `scope` (`wiki` / `all`) | 필수 키가 빠진 노트 |
| `unregistered-tags` | 끔 | `allowed` | 등록 안 된 태그 |
| `wiki-page-without-source` | 끔 | — | 원본을 하나도 인용하지 않는 위키 페이지 |
| `bad-filenames` | 켬 | — | `[ ] # ^ \| : ? * " < > \`가 들어간 이름 |

링크는 Obsidian처럼 해석해요: 정확한 경로 → 링크한 노트 기준 상대 경로 → 파일 이름 (가까운 폴더 먼저).

## Claude에게 이렇게

- *"이 글을 원본으로 저장하고 위키를 갱신해 줘."* → `wiki_layout` → `wiki_save_source` → `write_note`로 페이지 작성·수정 → `wiki_index` → `wiki_log`
- *"위키 점검하고 고칠 걸 알려 줘."* → `wiki_lint` → Claude가 보고, 내가 고르고, Claude가 고쳐요
- *"Redis 페이지를 가리키는 노트는?"* → `wiki_backlinks`

요약, 개념 페이지, 모순 판단은 Claude가 하고, 정확한 정리는 엔진이 해요.
