# The admin pages

One page at a time, in menu order. The admin pages open on your home network only; to open them from outside, switch it on under **Security** and use two-factor.

> In Safari, open the admin page and **Share → Add to Home Screen** to use it like an app, with the memexhub logo.

## Overview
- **Getting started** checklist: required · recommended · optional.
- **Status cards:** vault, Claude, payments, location … with when something last arrived. Payment messages to check show on the payments card.
- **Needs attention:** connection errors, messages to check.

<img src="assets/screens/en/overview.jpg" alt="Overview" width="720">

## Notes
A read-only view of the vault.
- Folder tree, search across all notes (search index), follow `[[wiki links]]`.
- Pictures in place, PDFs in a new tab.
- Obsidian syntax: callouts (folding ones too), `==highlights==`, task lists, tables. Mermaid stays as folded code; Obsidian draws it.
- **Confirm:** read a wiki page Claude wrote (draft) and press *I checked it* to make it stable.
- **Earlier versions:** every saved version of a note, and restore one.

<img src="assets/screens/en/notes.jpg" alt="Notes" width="720">

## Map
The day's route and the places you stayed. Only you see it; Claude and the vault never get coordinates. The map background (OpenStreetMap) is opt-in; this server fetches and keeps the pictures for 30 days.

<img src="assets/screens/en/map.jpg" alt="Map" width="720">

## Money
One month of card payments: what you spent against the same days of the month before, spending by day (hover a bar), the top 10 places, cards, recurring payments and, in busy months, the largest ones. Cancellations are subtracted; payments in another currency are counted apart. Only you see it.

## Vault
- **Where notes live:** built-in, a server folder, WebDAV, S3 / R2.
- **Wiki layout:** LLM Wiki, PARA (English or Korean folders), Zettelkasten, flat.
- **Write check:** a wiki page that cites no source is not saved.
- **Checks:** broken links, orphan pages, missing index entries … each with a name and what it finds.
- **Search index · change history:** state, rebuild, on/off.
- **Obsidian sync:** the WebDAV address for the built-in vault.

<img src="assets/screens/en/vault.jpg" alt="Vault" width="720">

## Claude app
- **How to add it:** copy the connector address → Claude app → Settings → Connectors → sign in and allow.
- **Every day, by itself: Claude routines:** Daily journal, Wiki ingest and Weekly check prompts to paste into Claude app routines.
- **Signed-in apps**, **what Claude can do** (tools, tool description language), tools that move or delete notes.

<img src="assets/screens/en/claude.jpg" alt="Claude app" width="720">

## Devices
- **Set up your phone:** one token per setup.
  - **Location:** the OwnTracks app, one QR scan.
  - **Card payments:** an iPhone Shortcuts automation forwards card texts.
  - **Share sheet:** links and text shared from any app become wiki sources.
- **Tokens** and where to send (`/ingest/...`).

<img src="assets/screens/en/devices.jpg" alt="Devices" width="720">

## Connections
Outside services, all optional.
- **Connected:** state (errors as a sentence saying what to do), **Edit**, Test, Turn off, **Delete**.
  - Edit opens the form filled with the saved settings; an empty password or token keeps the saved one.
  - Services with a list (Home Assistant entities) offer **Pick from the list**.
- **Add a connection:** a short name per service; opening one shows what it needs, an easier path if there is one, and where to find each value.
- Calendars (Google, iCloud, CalDAV, **calendar link (iCal)**), mail, tasks, location, place names, map background, weather, home (Home Assistant), music, Notion.

<img src="assets/screens/en/connections.jpg" alt="Connections" width="720">

## Features
Optional features and their settings (payment note paths, office places, receipt-mail folders; location source and private places; health note …). Adding a connection switches its feature on.

<img src="assets/screens/en/features.jpg" alt="Features" width="720">

## Messages
Texts, mails and app notifications become records: payments and receipts today; ads and codes can be skipped.
- **Please check:** messages memexhub was not sure about. Answer *It's a payment* with **read messages like this by themselves** on, and a recipe is made from that message and your answer.
- **Read by themselves:** senders with a recipe, recorded without asking. Claude's proposals are switched on here.
- **Recipe collection:** ready-made recipes (Hyundai and Samsung card texts, KCP and KICC receipt mails), off until you switch on the ones you use.
- **What is a recipe?:** match → extract → set and kind → examples, with an example key by key.
- **Advanced:** try a message, write a recipe (JSON), import and export. More: [message recipes](recipes.md).

<img src="assets/screens/en/messages.jpg" alt="Messages" width="720">

## Activity
Who connected, from where (IP), and what changed.

## Security · Backups
- **Security:** two-factor (QR), opening the admin pages from outside, accepting the Claude connector from Anthropic only, checks.
- **Backups:** download now, automatic daily copies (newest 14 kept), restore from a file, move from a previous setup (payment and health records, existing device tokens). Backups are encrypted with `MEMEXHUB_SECRET`; vault notes are not included.
