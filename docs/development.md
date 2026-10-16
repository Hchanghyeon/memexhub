# Development

This is the source of truth for how we work. `CLAUDE.md` and `CONTRIBUTING.md` summarize it.

## Branches

```
main      ← releases only (PR from develop + tag)
develop   ← integration, default branch, target of every PR
  └─ feat/…  fix/…  docs/…  chore/…  refactor/…  test/…   ← branch from develop
```

- `main` and `develop` are protected: PR required, required checks (`test`, `secrets`, `analyze`) must pass, linear history, no force pushes, no deletion, conversations resolved.
- Branch names: `<type>/<short-kebab-description>` — `feat/wiki-lint`, `fix/oauth-redirect-match`.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <imperative summary, ≤ 72 chars>

<why, when it isn't obvious>
```

Types: `feat` `fix` `docs` `refactor` `test` `chore` `perf` `ci` `build`. Scopes follow folders: `core` `storage` `auth` `http` `admin` `wiki` `ledger` …

## Commit identity — privacy

The repository is public and history is permanent.

- Commit with your **GitHub noreply address** (`<id>+<user>@users.noreply.github.com`), never a personal email:
  `git config user.email "<id>+<user>@users.noreply.github.com"` in this repo.
- In GitHub → Settings → Emails, turn on **Keep my email addresses private** and **Block command line pushes that expose my email**.
- **Never press a merge button on GitHub** (squash, merge commit *or* rebase). GitHub creates new commits for all three and records the merging account's **profile name and primary email** as author or committer.
- Instead, merge by **fast-forward**: when the PR is green, push the PR head to `develop` (`git push origin <branch>:develop`). No new commit is created, every commit keeps its noreply identity, and GitHub marks the PR as *Merged* automatically. A PR must therefore be rebased on the latest `develop` before merging.

## Dependencies

- Node: the **current LTS** (CI, Dockerfile and `engines` agree).
- Libraries: the **latest stable** release; Dependabot PRs are reviewed and merged promptly. No known vulnerabilities at merge time (`npm audit --omit=dev`, OSV-Scanner in CI).
- Prefer web standards and Node built-ins over a new package. A new runtime dependency needs a reason in the PR.

## Pull requests

- One PR = one concern. Split by layer when a change is large, in dependency order (e.g. core → storage → auth → surfaces → docs), and make **each PR build and pass tests on its own**.
- Aim for < 400 changed lines of code (docs and lockfiles excepted). Bigger needs a reason in the description.
- Use the PR template: *What · Why · How it was tested · Security checklist*.
- CI must be green. Address every review comment or resolve it with a reason.
- Merge by **fast-forward** (see *Commit identity*), then delete the branch.

## Before you push

```bash
npm run typecheck && npm test
git diff --staged          # read it: no secrets, personal data, real domains or transactions
gitleaks protect --staged  # if installed
```

Update the status markers in the docs (✅ 🚧 📝) when you finish something.

## After a merge

Check the new commits' author and committer identities (`git log --format='%an <%ae> | %cn'`). If anything personal appears, stop and fix it before more commits pile on.

## Releases

1. PR `develop` → `main` titled `release: vX.Y.Z`.
2. Fast-forward `main` to the release commit, tag `vX.Y.Z`.
3. Release notes with a separate **Security** section. Images are built and signed from the tag (planned).

## Local

```bash
npm install
cp .env.example .env     # MEMEXHUB_SECRET, PUBLIC_URL
npm run dev            # server
npm run dev:web        # admin web app with hot reload (http://localhost:5173/admin/)
npm run build:web      # what the server serves under /admin
npm test
npm run test:e2e       # the admin app in a real browser (after build:web; `npx playwright install chromium` once,
                       # or PW_CHROME=/path/to/chrome to use an installed one)
```
