# Contributing to apsolut-cortex

Thanks for the interest. cortex is a small, opinionated tool — contributions are welcome but please read this before opening a PR so we're aligned on scope.

## Before you start

- **Open an issue first** for anything bigger than a typo, missing CLI flag, or a one-file bugfix. The roadmap in [README](README.md) and the detailed plan in [docs/PHASE2-BUILD-ORDER.md](docs/PHASE2-BUILD-ORDER.md) describe what's in scope.
- **Out of scope by design:** code graph / tree-sitter, multi-tenant DB, localhost web UI, reviewer-agent personas, source adapters beyond Obsidian export. See the "What you do NOT build" section in PHASE2-BUILD-ORDER.

## Setup

```bash
git clone https://github.com/apsolut/apsolut-cortex.git
cd apsolut-cortex
bun install
bun test          # currently 72 passing across 11 files
bun run build     # outputs dist/ + scripts/
```

Detailed dev setup is in [LOCAL_SETUP.md](LOCAL_SETUP.md) (gitignored locally — see the `.gitignore`).

## Code conventions

- **TypeScript** strict mode, ESM (`type: "module"` in `package.json`).
- **No comments that explain WHAT the code does** — well-named identifiers do that. Only add a comment when WHY is non-obvious: a hidden constraint, a workaround for a specific bug, behavior that would surprise a reader.
- **No backwards-compat shims, removed-code comments, or feature flags for hypothetical futures.** Three similar lines is better than a premature abstraction.
- **No new dependencies > 100 KB without justification.** See `build.ts` for the `external` list pattern.
- **Path invariant: never use `~/.apsolut/`** — it's reserved for other `apsolut-*` tools. cortex uses `~/.apsolut-cortex/` exclusively.

## Testing

- `bun test` runs every `*.test.ts` file. Tests use the built-in `bun:test` runner — no vitest, no jest.
- For tests that need a DB, use `createClient({ url: ":memory:" })` + `runMigrations(db)`. Never run tests against the user's real `~/.apsolut-cortex/memory.db`.
- For tests that need the keychain, use a unique per-test service name (`apsolut-cortex-test-${process.pid}-${Date.now()}`) and clean up in `afterAll`. See `src/keyring.test.ts` for the pattern.
- Coverage isn't tracked yet; the bar is "the new code has at least one test that would catch the bug it was written to fix."

## Migrations

Schema changes go into `src/migrations/NNN-name.ts` and get registered in `src/migrations/runner.ts`. Every migration must be safe to run against a populated production DB — use `CREATE TABLE IF NOT EXISTS`, PRAGMA-check before `ALTER TABLE ADD COLUMN`, and never `DROP COLUMN` without a clear rollback story.

## Commits

- Short imperative subject line ("add foo", "fix bar"), ≤72 chars.
- Body explains the WHY for anything non-obvious.
- **No `Co-Authored-By` lines** for AI-assisted commits — the user authored this codebase; AI tooling is just an editor.
- Bump `package.json` version in the same commit as the change (patch for fixes/docs/internal, minor for new CLI/MCP surface).
- Add a `CHANGELOG.md` entry for every published version.

## Pull requests

- Target `main`.
- Run `bun test` and `bun run build` before pushing — CI will run the same.
- Include a screenshot or terminal output for anything that changes user-visible behavior.
- Don't squash-merge across multiple logical changes; one PR, one concept.

## Architecture decisions

Significant choices live in `docs/decisions/NNN-title.md` (ADR format). Existing examples:

- [001 — libSQL over better-sqlite3](docs/decisions/001-libsql-over-better-sqlite3.md)
- [002 — Async compression via detached workers](docs/decisions/002-async-compression.md)

Write one whenever a PR rules something out permanently or makes a load-bearing change.

## Security

If you find a security issue, please use the disclosure process in [SECURITY.md](SECURITY.md) rather than opening a public issue.
