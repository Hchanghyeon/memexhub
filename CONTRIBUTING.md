# Contributing

Thanks for helping! A few ground rules:

1. Branch from `develop`, open a PR into `develop`. Keep PRs focused (one feature or fix). Maintainers merge by fast-forward, so keep your branch rebased on `develop`. Full workflow: [docs/development.md](docs/development.md).
2. Commit with your GitHub **noreply** email, never a personal address.
3. `npm run typecheck && npm test` must pass. CI also runs CodeQL, secret scanning and dependency scanning.
4. Follow the architecture and security rules in [CLAUDE.md](CLAUDE.md): they apply to humans too.
5. **Never include real personal data** in code, fixtures, screenshots or issues. Use fake examples.
6. New provider? See [docs/adding-a-provider.md](docs/adding-a-provider.md). New card issuer parser? Add fake SMS fixtures with expected output.
7. UI changes follow [docs/design.md](docs/design.md).
8. Security issues go through [SECURITY.md](SECURITY.md), not public issues.

Commit messages: short imperative summary (`feat(storage): add s3 adapter`), body explaining why when it isn't obvious.
