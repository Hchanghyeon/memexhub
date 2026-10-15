# Contributing

Thanks for helping! A few ground rules:

1. Branch from `develop`, open a PR into `develop`. Keep PRs focused (one feature or fix).
2. `npm run typecheck && npm test` must pass. CI also runs CodeQL, secret scanning and dependency scanning.
3. Follow the architecture and security rules in [CLAUDE.md](CLAUDE.md) — they apply to humans too.
4. **Never include real personal data** in code, fixtures, screenshots or issues. Use fake examples.
5. New provider? See [docs/adding-a-provider.md](docs/adding-a-provider.md). New card issuer parser? Add fake SMS fixtures with expected output.
6. Security issues go through [SECURITY.md](SECURITY.md), not public issues.

Commit messages: short imperative summary (`feat(storage): add s3 adapter`), body explaining why when it isn't obvious.
