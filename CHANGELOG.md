# Changelog

All notable changes to apsolut-cortex are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.2] – 2026-05-24

### Fixed
- `apsolut-cortex eval` now prints a clean "maintainer-only" message when invoked from a global npm install, instead of dying on a missing `evals/runner.ts` (the eval harness lives outside the published tarball by design). Help banner cleaned up accordingly.

## [0.6.1] – 2026-05-24

### Changed
- README's storage section corrected: the on-disk format is libSQL (Turso's SQLite fork), not vanilla SQLite. Added a short note that any `sqlite3` CLI can still read the file and that migration to Turso cloud is a URL change.
- `docs/STORAGE.md` expanded with the three concrete `createClient` shapes for the future Turso migration path (local file / pure cloud / cloud + embedded replica). All work identically against the existing schema — preserves the option without committing to it.

## [0.6.0] – 2026-05-24

### Added
- **M1 eval harness (Phase 2):** `evals/` directory with `golden.jsonl` (5 seeded entries, target 30), `evals/fixtures/seed.ts` (reproducible in-memory fixture DB with 10 known memories), `evals/runner.ts` (hit rate + MRR computation), `apsolut-cortex eval run` and `apsolut-cortex eval baseline` CLI subcommands. Each run scores **two** retrievals side-by-side: the production hybrid path and a tokenized-grep baseline. The runner prints a verdict line — if hybrid beats grep by ≥5pp we keep the complexity; if grep matches or wins we have license to simplify in M8. At 5 seeded queries with hand-picked content both score 5/5; the gap will only appear at 20+ entries with more paraphrased queries (per the eval README guidance).
- **`searchGrep(db, projectId, query, limit)`** in `src/db.ts` — Karpathy "LLM reads the markdown" baseline. Tokenizes the query (≥3 chars, stop-words dropped), scores by token-overlap count, breaks ties by recency.
- **Shadow mode** in the MCP server: when `APSOLUT_CORTEX_SHADOW=true`, `memory_search` still runs retrieval but returns nothing to Claude. Would-be matches are appended to `~/.apsolut-cortex/logs/shadow.jsonl` for offline analysis. Lets us tune retrieval against real sessions without polluting the conversation.

## [0.5.7] – 2026-05-24

### Added
- **M0 pre-flight (Phase 2):** `bun:test` smoke test, migration system (`src/migrations/`, `_migrations` table, runner with sentinel-row lock), `apsolut-cortex migrate` CLI command, `CHANGELOG.md`, `docs/` scaffolding (`OPERATIONS.md`, `STORAGE.md`, `PROVIDERS.md`, `CONFIG.md`, `OLLAMA.md`, `decisions/`).
- **001-initial-schema migration:** existing schema extracted into `src/migrations/001-initial-schema.ts`. Runner detects existing DBs and back-fills the migration row without re-running SQL.

### Changed
- `~/.apsolut/` is now documented as a permanent invariant — never to be used by this plugin. The path is reserved for other `apsolut-*` tools. `.npmignore`, `README.md`, and `docs/PHASE2-BUILD-ORDER.md` updated to frame this as a rule, not a one-time rename.

### Roadmap
- Karpathy's personal-LLM-wiki insights folded into the roadmap: M1 gains a `searchGrep` baseline (test whether hybrid RAG actually beats substring match at our scale), M2 gains bidirectional capture (`apsolut-cortex correct --with "..."`), M5 gains compiled views (`index.md`, per-category pages, `_health.md`, inter-memory `[[wiki-links]]`), and M8 gains a standing `apsolut-cortex audit` linting command.

## [0.5.6] – 2026-04-21

### Fixed
- Skill docs and onboarding banner aligned with the real MCP tool schemas.
- Skill names made consistent across onboarding.
- `hono` pinned to 4.12.14 (GHSA-458j-xx4x-4375).
- Replaced `@xenova/transformers` with `@huggingface/transformers` (CVE-2026-41242).

## [0.5.3] – 2026-04-19

### Fixed
- Skill names renamed to `apsolut-*` prefix to avoid colliding with Claude built-in skills.

### Added
- `[apsolut-cortex]` prefix on all output.

## [0.5.2] – 2026-04-19

### Added
- `repository`, `homepage`, and `bugs` fields in `package.json` for npm metadata.

## [0.5.1] – 2026-04-19

### Changed
- README env-var table rewritten as a list for better readability on npm.

## [0.5.0] – 2026-04-19

### Changed
- Env var prefix renamed from `CORTEX_*` to `APSOLUT_CORTEX_*`.

### Fixed
- README clarified: sessions are automatic, not a clean-start ritual.

## [0.4.1] – 2026-04-13

### Changed
- Data namespace renamed from `~/.apsolut/` to `~/.apsolut-cortex/` (reserves `~/.apsolut/` for other `apsolut-*` tools).
- Phase 2 roadmap added to README; install instructions and storage path corrected.
- `.mcp.json` gitignored (machine-specific paths).
- Phase 2 build order plan added (v3, fact-checked against the codebase).

### Fixed
- Memory system hardening: pruning bug, transaction safety, atomic writes, config externalization.

## [0.4.0] – 2026-04-12

### Added
- Initial public release on npm.

[Unreleased]: https://github.com/apsolut/apsolut-cortex/compare/v0.6.2...HEAD
[0.6.2]: https://github.com/apsolut/apsolut-cortex/compare/v0.6.1...v0.6.2
[0.6.1]: https://github.com/apsolut/apsolut-cortex/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.7...v0.6.0
[0.5.7]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.6...v0.5.7
[0.5.6]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.3...v0.5.6
[0.5.3]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/apsolut/apsolut-cortex/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/apsolut/apsolut-cortex/releases/tag/v0.4.0
