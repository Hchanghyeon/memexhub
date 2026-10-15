# Development

## Branching

```
main      ← releases only (PR from develop + tag)
develop   ← integration; default target for PRs
  └─ feat/… fix/… docs/… chore/…   ← branch from develop, PR back into develop
```

- Both `main` and `develop` are protected: PR required, CI must pass, no force pushes.
- Keep PRs small and focused. Squash or rebase merge.
- Release: PR `develop` → `main`, tag `vX.Y.Z`, release notes with a separate *Security* section.

## Local

```bash
npm install
npm run dev          # needs MEMEXHUB_SECRET and PUBLIC_URL (see .env.example)
npm test
npm run typecheck
```

## Before you push

- `npm run typecheck && npm test`
- read your diff for personal data or secrets; run `gitleaks protect --staged` if installed
- update docs status markers (✅ 🚧 📝) when you finish something
