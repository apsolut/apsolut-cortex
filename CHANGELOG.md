# Changelog

All notable changes to apsolut-cortex are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- **M0 pre-flight (Phase 2):** `bun:test` smoke test, migration system (`src/migrations/`, `_migrations` table, runner with transaction-per-migration + advisory lock), `apsolut-cortex migrate` CLI command, `CHANGELOG.md`, `docs/` scaffolding (`OPERATIONS.md`, `STORAGE.md`, `PROVIDERS.md`, `CONFIG.md`, `OLLAMA.md`, `decisions/`).
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

[Unreleased]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.6...HEAD
[0.5.6]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.3...v0.5.6
[0.5.3]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.2...v0.5.3
[0.5.2]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/apsolut/apsolut-cortex/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.4.1...v0.5.0
[0.4.1]: https://github.com/apsolut/apsolut-cortex/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/apsolut/apsolut-cortex/releases/tag/v0.4.0
