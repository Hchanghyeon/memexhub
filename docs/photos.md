# Photos ✅

Mount a phone photo backup into memexhub **read-only** and Claude looks at the day's pictures as **small previews** to fill the journal. Pictures are never changed or moved, and previews are not stored anywhere. Switch on **Features → Photos** and pick the folder under **Connections → Photos**.

| Picture | What Claude does |
|---|---|
| food or drink | records it with `meal_add` (asks about the portion when unsure) |
| a receipt | matches it with that time's payment (`payments_day`) and tells you the shop, total and items (does not record payments itself) |
| a document, notes, a whiteboard, a book | writes the text out and saves it with `wiki_save_source` |
| a screenshot | one line on what it was (never copies other people's messages) |
| a place, an event, a view, something bought, a workout | one line for the journal |

**Rules it keeps:** it never identifies faces or guesses names (only when the calendar or you said who). Card, account and ID numbers, passwords and codes are never written out ("personal information, skipped"). It never invents what a picture does not show.

## Setting it up

1. Let your phone back up pictures to a server folder: **Synology Photos** mobile backup (`homes/<user>/Photos/MobileBackup`), Nextcloud auto-upload, Syncthing …
2. Mount it into the container read-only: `- /path/to/Photos/MobileBackup:/photos:ro` (allowed roots: `PHOTO_ROOTS`, default `/photos`).
3. Admin → Connections → Photos → **Photo folder on this server**, folder `/photos`.
4. Features → switch on **Photos**.

- **When a picture was taken** is its file modification time, which backup apps set to the capture time.
- **Previews** are the photo app's own thumbnails (Synology `@eaDir/…/SYNOPHOTO_THUMB_M.jpg`), else a JPEG or PNG original up to 1.5 MB. HEIC without a thumbnail is listed only (no image library is bundled).
- Bursts (within 3 s) count once; a long day is spread evenly, up to 24 previews.

**iPhone tip:** iOS does not let apps back up freely in the background. A Shortcuts automation **when the charger is connected / when the wake-up alarm stops → Open App (Synology Photos)** uploads twice a day. The nightly routine looks at yesterday again, so late pictures are filled in the next night.

## Tool and summaries

- `photos_day(date?, from?, to?, kinds?, limit?)`: the day's (or a time window's) pictures with preview images
- `day_summary`: "📷 photos 28 · screenshots 4 · videos 2", and in each scene how many were taken there (📷 3)
