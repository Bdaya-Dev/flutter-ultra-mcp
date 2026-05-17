# Contributing to flutter-ultra-mcp

Thanks for considering a contribution! This guide covers everything you need to develop, test, and ship changes.

## Prerequisites

- **Node.js** 20 or 22 (LTS)
- **Flutter** stable channel
- **Dart** 3.5+
- Git with submodule support
- Platform-specific tooling for the server you're working on (e.g. Android SDK + `adb` for `flutter-ultra-native-mobile`)

You do not need any Bdaya internal resources. This plugin is fully self-sufficient — a fresh clone, `npm install`, and `npm test` is enough.

## Clone

```bash
git clone https://github.com/Bdaya-Dev/flutter-ultra-mcp.git
cd flutter-ultra-mcp
git submodule update --init --recursive
npm install
```

## Repository layout

```
.claude-plugin/      Plugin manifest
.mcp.json            Declares all 8 MCP servers
packages/            8 MCP server packages + 3 Dart packages
shared/              TS shared libs (vm-service-client, mcp-runtime, state-store, keyring)
skills/              Claude Code skills (one folder per skill)
hooks/               PreToolUse / SessionStart / Stop hook configs
sidecars/            Bundled native helpers (signed/notarized in CI)
vendor/              Plugin-owned dependencies (e.g. patrol fork submodule)
scripts/             Cross-platform helper scripts referenced by hooks
docs/                Architecture + contracts + platform matrix
.github/workflows/   GitHub Actions CI (per §18.12 of plan)
```

## Conventional Commits — mandatory

Every commit must follow [Conventional Commits 1.0](https://www.conventionalcommits.org/).

```
<type>(<scope>)?: <subject>
```

| Type | Effect on version | Example |
|---|---|---|
| `feat` | minor bump | `feat(gesture): add scroll_until_visible` |
| `fix` | patch bump | `fix(runtime): handle DDS reconnect race` |
| `feat!` / `fix!` / `BREAKING CHANGE:` footer | major bump | `feat(api)!: rename screenshot to take_screenshot` |
| `perf` | patch bump | `perf(browser): cache Playwright contexts` |
| `refactor`, `docs`, `test`, `chore`, `build`, `ci`, `style` | no version change | `chore(deps): bump zod to 3.25` |

`commitlint` runs as a `commit-msg` hook (installed by `husky`) and as a PR-blocking CI check.

## Branches

- **`main`** — production
- **`next`** — pre-release (prerelease tag `next`)
- **`alpha`** / **`beta`** — unstable channels

## Adding a new MCP server

1. Copy the layout of an existing `packages/flutter-ultra-*/` package
2. Add an entry to `.mcp.json` at the repo root
3. Add a `tsconfig.json` project reference in the root `tsconfig.json`
4. Implement tools using `@flutter-ultra/mcp-runtime` scaffolding
5. Add unit + integration tests under `packages/<name>/tests/`
6. Update `skills/` for any user-facing workflows

## Adding a new skill

Skills are markdown files at `skills/<name>/SKILL.md`. Follow the conventions in plan §16.8.

## Local testing

```bash
# Build all packages
npm run build

# Run all unit + integration tests
npm test

# Run a single package's tests
npm test --workspace=@flutter-ultra/runtime

# Lint + format
npm run lint
npm run format
```

Use `npx @modelcontextprotocol/inspector --cli node packages/<name>/dist/index.js --method tools/list` to smoke-test a built server.

## Pull requests

1. Add a [changeset](https://github.com/changesets/changesets): `npm run changeset`
2. All CI gates must pass (lint, unit, integration, contract, coverage thresholds, MCP Inspector smoke).
3. Squash-merge with a Conventional Commits subject. Reviewers will preserve the conventional commit by editing the merge subject if needed.

## Code of Conduct

This project adopts the [Contributor Covenant 2.1](CODE_OF_CONDUCT.md). By participating you agree to abide by its terms.

## License

Contributions are licensed under Apache-2.0 (see [LICENSE](LICENSE)).
