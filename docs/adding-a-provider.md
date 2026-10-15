# Adding a provider

Example: a new storage adapter.

1. Implement the interface in `src/storage/<id>.ts` (or `src/providers/<kind>/<id>.ts` for other kinds). Use only `fetch` and web standards if it should run on Workers.
2. Register a builder in the storage factory (`src/storage/factory.ts`, or the runtime entry point if it needs `node:*`).
3. Add it to the contract test list in `test/contract/storage.test.ts` and make it pass.
4. Declare config and secrets with zod so the admin UI can render the form. Secrets are encrypted and never returned.
5. Security checklist:
   - only call hosts the admin configured; no redirects; timeouts
   - never log credentials or content
   - least-privilege scopes (e.g. read-only mail, only the needed Notion pages)

## A new card issuer (ledger) 📝

1. `src/modules/ledger/issuers/<issuer>.ts` with `detect(text)` and `parse(text)`.
2. Fake SMS samples in `test/fixtures/sms/<issuer>/*.txt` with expected JSON. Never paste a real message — rewrite names, merchants, amounts and balances.
3. Add odd inputs to the fuzz cases.
