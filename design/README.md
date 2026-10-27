# Design tokens

One file, [`tokens.json`](tokens.json), holds every color, text style, spacing step, radius and motion value of memexhub's interfaces. The Android app and the admin web app are generated from it, so they cannot drift apart.

Direction: clean and calm, **big numbers first**, the logo's ink (`#18181B`) for text with **one** brand color, index blue (`#3355E0`, `#7F9BFF` in dark). No shadows: cards sit on a slightly darker page. Status colors (`ok`, `warn`, `danger`) mean state, never decoration, and always come with a word.

## Changing a token

1. Edit `tokens.json`. Every color has a light and a dark value and a `use` line saying what it is for.
2. `npm run tokens` writes
   - `android/app/src/main/kotlin/…/ui/theme/Tokens.kt` (`MxLight`, `MxDark`, `MxType`, `MxSpace`, `MxRadius`, `MxLayout`, `MxMotion`)
   - `web/src/tokens.css` (`--mx-*` variables, dark under `.dark`)
3. Commit the JSON and the generated files together. CI runs `npm run tokens:check` and fails when they differ.

## Using tokens on Android

- Colors: `Mx.colors.accent`. Material components already follow the tokens through the theme.
- Text: `MxType.display` (the one big number on a card), `title`, `headline`, `body`, `label`, `caption`.
- Spacing and shape: `MxSpace.m`, `MxRadius.card`, `MxLayout.gutter`.
- `design/lint-android.mjs` (part of `tokens:check`) rejects color literals, font-size literals and ad-hoc `TextStyle`s outside `ui/theme`. A line that truly needs one ends with `// token-ok: <reason>`.

## Screens

Every Android screen is designed for a foldable first: the narrow cover screen and phones under `layout.twoPane` (600 dp) get one column and a bottom bar; from 600 dp (an unfolded Galaxy Z Fold, tablets) a side rail and two columns.
