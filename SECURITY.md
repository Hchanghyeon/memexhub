# Security policy

## Supported versions

memexhub is in early development. Only the latest `0.x` release (and `develop`) receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Use GitHub's private reporting: **Security → Report a vulnerability** on this repository.

Include what you found, how to reproduce it, and the impact you expect. You will get an acknowledgement within 7 days and a status update at least every 14 days until it is resolved. Fixes are credited in the changelog unless you prefer otherwise.

## Scope

In scope: this repository's code, default configuration, Docker image and documentation that leads to an insecure setup.

Out of scope: vulnerabilities in third-party services (Claude, Obsidian, your reverse proxy), social engineering, and attacks that require an already-compromised admin account or server.

## Design

The threat model and the controls are documented in [docs/security.md](docs/security.md).
