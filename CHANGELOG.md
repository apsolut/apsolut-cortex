# Changelog

All notable changes to apsolut-cortex are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.12.0] – 2026-05-25

### Added
- **M5 visibility layer — finished (Phase 2):**
  - **Compiled views** in the Obsidian vault export: `by-category/<cat>.md` (every memory of a category across all projects, sorted by weight), `by-project/<name>.md` (per project, grouped by category), `_health.md` (low-trust high-use → consider `promote`; high-trust stale > 60d → consider `demote`; flagged-by-`memory_contradict`). All compiled views regenerate from scratch on every full export and stale files are GC'd.
  - **Curation CLI commands:**
    - `apsolut-cortex promote <id>` / `demote <id>` — walk the trust ladder (`observed → validated → proven → canonical`).
    - `apsolut-cortex tag <id> <tag>` / `untag <id> <tag>` — free-form labels. Tags are lowercased and de-duped; `INSERT OR IGNORE` on the composite PK.
    - `apsolut-cortex grep <pattern>` — substring search across content + context in the current project (top 50 hits).
    - `apsolut-cortex delete` with `--id`, `--project`, `--tag`, `--before YYYY-MM-DD`, `--grep <pat>`. Filters combine with AND. Always shows a preview of the first 5 matches; refuses to run without `--yes`. No raw SQL accepted by design.
  - **Tags in frontmatter:** memory `.md` files now include `tags:` array and a `[[tag-<name>]]` link footer for Obsidian graph view.
- **Migration 004 — `memory_tags` table:** `(memory_id, tag, created_at)` with composite PK and a `(tag, memory_id)` index. Append-only; deletion is GC'd when the parent memory is removed.
- **`src/curation.ts`** module with `promoteMemory` / `demoteMemory` / `tagMemory` / `untagMemory` / `getTagsForMemory` / `grepMemories` / `previewDeletion` / `applyDeletion` — 12 unit tests covering the trust ladder, tag round-trip, all delete-filter shapes, and the invalid-date guard.

## [0.11.0] – 2026-05-25

### Added
- **M6 in-session compression (opt-in, Phase 2):** memories now land *during* the session, not just at SessionEnd. Triggered by conversation token budget (default 30000) with a hard safety net at 1.2× that threshold. Activates the M4 `raw_messages` table — `memory_recall(id)` now returns actual transcript history for any memory produced after upgrade.
  - **`src/tokens.ts`** — `gpt-tokenizer`-backed local estimator. Never calls a model just to count tokens. Handles structured-block content (`text`, `tool_use`, `tool_result`) flattening for Claude Code transcript format.
  - **`src/buffer.ts`** — per-session JSONL spill + single-flight lockfile + cursor (last-compressed `msg_idx`). Survives process kills; cursor makes re-runs idempotent.
  - **`src/transcript.ts`** — `readTranscript()` / `sliceRange()` / `persistRawMessages()` / `captureTranscript()`. Parses the JSON-l transcript Claude Code hands every hook via `transcript_path`.
  - **`src/compress-runner.ts`** — shared `compressSlice()` used by PreCompact, the detached worker, and SessionEnd. Persists raw messages, slices by cursor, compresses via existing `compress.ts` pipeline (Haiku → Ollama fallback + circuit breaker), inserts memories with `source_session_id` / `source_start_msg_idx` / `source_end_msg_idx` set so `memory_recall` can resolve them later.
  - **`src/hooks/pre-compact.ts`** — synchronous emergency capture before Claude Code compacts. Waits up to 3 s for any running worker, then force-acquires the lock.
  - **`src/hooks/compress-worker.ts`** — detached background worker spawned by PostToolUse when the token budget is hit. Honors the single-flight lock and exits quietly if another worker is already running.
  - **`src/hooks/post-tool-use.ts`** — updated with the token-budget trigger; spawns the worker async at threshold, falls back to synchronous compression at 1.2× threshold.
  - **`src/hooks/session-end.ts`** — calls `compressSlice` for the final tail of the session so every memory has a source range, then `clearAllForSession` cleans up buffer artifacts.
  - **`src/reflector.ts` + SessionEnd integration** — when this session's memories exceed `APSOLUT_CORTEX_REFLECT_THRESHOLD` tokens (default 40000), re-summarize them into denser `tier=meta`, `source=reflector` memories. Conservative v1: SessionEnd only.
  - **`templates/hooks-m6.json`** + **`apsolut-cortex install-hooks`** CLI — opt-in hook installer that wires `SessionStart + PostToolUse + Stop + SessionEnd + PreCompact` into `~/.claude/settings.json`. Existing users on legacy `init`-installed hooks are not affected until they explicitly opt in.
- **3 new env vars in `src/config.ts`:** `APSOLUT_CORTEX_OBSERVE_THRESHOLD` (30000), `APSOLUT_CORTEX_OBSERVE_BLOCK_MULT` (1.2), `APSOLUT_CORTEX_REFLECT_THRESHOLD` (40000).
- **3 new test files (tokens, buffer, transcript)** — 25 new tests; 59/59 total tests passing across 10 files.
- **`docs/decisions/002-async-compression.md`** explains why we use detached child processes instead of the speculated `"async": true` hook flag (which doesn't exist in Claude Code 2.x).
- `CHANGELOG.md` and `templates/` added to the published `files` array in `package.json`.

### Dependencies
- Added `gpt-tokenizer@^3.4.0` for local conversation-token counting.

## [0.10.0] – 2026-05-24

### Added
- **M5 visibility layer (partial, Phase 2):** `apsolut-cortex export` writes one markdown file per memory to `~/.apsolut-cortex/obsidian/memories/` with full YAML frontmatter (id, project, tier, category, trust, weight, used_count, created_at, last_used, source, source_session_id). Body includes the memory content, optional context section, and `[[wiki-links]]` to the project + category. The vault is regenerated from scratch each time; orphaned `.md` files (memories no longer in the DB) are garbage-collected.
- **`index.md`** at the vault root: grouped by project → category, sorted by weight within each group, with `[[link]]`s to every memory file. The header marks the vault as generated output.
- **Auto-export on `SessionEnd`:** the existing session-end hook now calls `exportVault` after compression + decay/prune. Wrapped in its own try/catch so a markdown write failure can't break compression.
- **`apsolut-cortex export`** CLI command for manual triggers.
- 4 export tests against an isolated tmp vault dir — file shape, frontmatter, orphan GC, project-filter mode. 34/34 total tests passing.

### Pending in M5 (rolled into a future commit, not blocking 0.10.0)
- `apsolut-cortex promote` / `demote` / `tag` / `grep` / `delete` CLI commands.
- Compiled views: per-category pages, per-project pages, `_health.md` for low-trust / contradiction-candidate memories.
- Inter-memory `[[wiki-links]]` based on content overlap.

## [0.9.0] – 2026-05-24

### Added
- **M4 range-linked memories (Phase 2):** two new migrations and a new MCP tool let compressed memories point back at the raw conversation slice they were derived from.
  - Migration 002 adds nullable `source_session_id`, `source_start_msg_idx`, `source_end_msg_idx` columns to `memories` + a `(source_session_id, source_start_msg_idx)` index. PRAGMA check before each ADD COLUMN so re-runs are no-ops.
  - Migration 003 creates `raw_messages(session_id, msg_idx, role, content, created_at)` with composite primary key + `(session_id, created_at)` index. Append-only.
  - `insertMemory()` accepts optional `source_session_id` / `source_start_msg_idx` / `source_end_msg_idx`. Existing call sites unchanged (defaults to NULL).
  - `insertRawMessage()`, `getRawRange()`, `getMemoryWithRange()` helpers added to `src/db.ts`.
  - New MCP tool `memory_recall(id)` — returns the raw transcript slice for a memory, or a clear message if the memory predates M4 (NULL ranges) or the raw window was pruned by retention.
- `APSOLUT_CORTEX_RAW_RETENTION_DAYS` env var (default 90) documented in `src/config.ts`. The cleanup job lands with M8's `is_pinned` work; until then all raw_messages rows are retained.

## [0.8.0] – 2026-05-24

### Added
- **M3 encryption at rest + backup/restore (opt-in, Phase 2):** libSQL-native encryption via `encryptionKey` on `createClient()`. Key is stored in the OS keychain (`@napi-rs/keyring` → Windows Credential Manager / macOS Keychain / libsecret) under service `apsolut-cortex`, account `db-encryption-key`.
- **`apsolut-cortex db re-encrypt`** CLI command: opt-in migration of the existing plaintext DB. Generates a 256-bit key, snapshots the current DB to `~/.apsolut-cortex/backup/pre-encrypt-<ts>.db` (never deleted), copies every row into a fresh encrypted DB, atomically replaces the live file. Dry-run by default; requires `--yes` to proceed. Original DB untouched on any failure.
- **`apsolut-cortex backup`** CLI command: physical file snapshot to `~/.apsolut-cortex/backup/manual-<ts>.db`.
- **`apsolut-cortex restore [<path>] [--yes]`** CLI command: lists snapshots without args; restores with `--yes`. Always writes a pre-restore safety snapshot first.
- **`src/keyring.ts`** + **`src/backup.ts`** modules with focused unit tests. Round-trip test verifies that a re-encrypted DB reads back correctly with the key, fails to open without it, and that FTS5 search still works after re-encryption.
- **`docs/OPERATIONS.md`** updated with the encryption opt-in flow, backup/restore commands, and the "do not nuke the keychain after encrypting" warning.

### Changed
- `getDb()` now checks the OS keychain on first connection. If a key is present it is passed to `createClient({ encryptionKey })`; if absent, the DB opens unencrypted (same behavior as before this release). Existing users are unaffected until they explicitly run `apsolut-cortex db re-encrypt --yes`.
- `build.ts` marks `@napi-rs/keyring` as external so its native bindings resolve from `node_modules/` at runtime rather than being bundled.

### Dependencies
- Added `@napi-rs/keyring@^1.3.0` for OS keychain access (native, ~few hundred KB per platform).

## [0.7.0] – 2026-05-24

### Added
- **M2 retrieval audit log (Phase 2):** every `memory_search` call now appends one JSONL line to `~/.apsolut-cortex/logs/retrievals.jsonl` with the query, per-candidate scores (BM25 rank, vector rank, final rank), tier/trust/weight, what was actually injected back to Claude, and end-to-end latency. Shadow mode entries continue to route to `shadow.jsonl` so the production log stays clean.
- **`apsolut-cortex correct`** CLI command: reads the most recent retrieval and flags it as a miss in `~/.apsolut-cortex/logs/corrections.jsonl`. Pass `--with "<correct answer>"` to also insert the correction as a new `correction`-category memory linked back to the failing retrieval. Karpathy's "outputs feed back in" — the user's miss-labeling gesture now grows the knowledge base instead of just instrumenting it.
- **`src/logs.ts`** module: shared JSONL append + read helpers, used by the MCP server, the CLI `correct` command, and tests. Refactors the ad-hoc shadow-logging in `mcp/server.ts` so all three log streams share one implementation.

### Changed
- `hybridSearch()` in the MCP server now returns per-source ranks alongside the result list so the audit log can record where each memory came from in the BM25 vs vector lists.

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

[Unreleased]: https://github.com/apsolut/apsolut-cortex/compare/v0.12.0...HEAD
[0.12.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.11.0...v0.12.0
[0.11.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.9.0...v0.10.0
[0.9.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/apsolut/apsolut-cortex/compare/v0.6.2...v0.7.0
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
