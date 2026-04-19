# apsolut-cortex Phase 2 — Build Order (v3, fact-checked against actual codebase)

> Paste this entire document as the first message to your AI coding agent (Claude Code, etc.) when starting Phase 2 work on `apsolut-cortex`.

## What changed from v2

A fact-check against the actual codebase surfaced corrections worth flagging up top:

- **Stack:** project uses `@libsql/client` (Turso's libSQL fork) + Bun, not `better-sqlite3` + npm.
- **Encryption:** libSQL has built-in encryption (`encryptionKey` config). SQLCipher is removed.
- **Vector search:** libSQL has native vector functions (`F32_BLOB`, `vector_distance_cos`) already in use. The v2 sqlite-vec milestone was based on a false premise — removed.
- **Test framework:** none currently installed. Bun's built-in `bun:test` is preferred over adding vitest.
- **Naming:** CLI binary is `apsolut-cortex`, not `cortex`. MCP tools have `memory_` prefix. New tool added below is `memory_recall`.
- **Paths:** `~/.apsolut-cortex/memory.db` (the user is keeping the `.apsolut-cortex/` namespace deliberately so future `apsolut-*` projects can sit alongside without collision).
- **Migration system:** does not exist yet. Built in Milestone 0 instead of assumed.
- **Env var count:** ~16, not 25+.

---

## Context

You are working on `apsolut-cortex`, a TypeScript MCP server providing memory and knowledge management for Claude Code. Phase 1 is shipped:

- **libSQL** (`@libsql/client`) with FTS5, native vector support (`F32_BLOB(N)`, `vector_distance_cos()`), and built-in encryption capability
- 5 memory tiers, 6 categories, 4 trust tiers with auto-promotion
- EMA-weighted decay + pruning
- Hybrid retrieval: BM25 (FTS5) + native vector cosine + RRF + MMR — **all SQL-native**
- Session hooks: `SessionStart`, `PostToolUse`, `Stop`, `SessionEnd` (Claude Code's PascalCase event names)
- Compression via Claude Haiku (current: 4.5) with Ollama fallback + circuit breaker
- 5 MCP tools: `memory_search`, `memory_store`, `memory_rate`, `memory_contradict`, `memory_status`
- CLI: `apsolut-cortex init`, `apsolut-cortex status`, `apsolut-cortex uninstall`
- `<private>` tag stripping before storage
- ~16 `CORTEX_*` env vars for tuning

Build tool: **Bun** (`bun run build.ts`). Environment: Windows 11 + WSL2, single-user. DB at `~/.apsolut-cortex/memory.db`. libSQL is the single source of truth.

---

## What this plan assumes about Claude Code

- Hooks use PascalCase event names (`PreToolUse`, `PostToolUse`, `SessionStart`, `Stop`, `SessionEnd`, `PreCompact`, `UserPromptSubmit`, etc.) and receive event JSON on stdin, not env vars.
- Hook config lives in `.claude/settings.json` per project or `~/.claude/settings.json` globally.
- Async hooks (`"async": true`) and the `PreCompact` event are 2026 features. Verify the installed version supports them before Milestone 6: `claude --version` and check the `/hooks` reference. If the installed version is older, upgrade or scope down M6 (see notes there).

---

## Prime directive

Ship **the eval harness, range-linked memories, and the visibility layer first.** No new features beyond the build order below until they ship and produce signal. Code graph, review agent, web dashboard, source adapters — explicitly deferred.

If you finish a milestone early, do not start a deferred item. Re-read this prompt and pick the next item in order.

---

## Build order — strict, sequential

### Milestone 0 — Pre-flight (single sitting before M1)

Quick infrastructure that everything else assumes. Get this out of the way in one focused pass. Each item is small; the whole thing is half a day of work.

- **Namespace rename:** rename all `~/.apsolut/` references in the codebase to `~/.apsolut-cortex/`. Touches at minimum: `CORTEX_DIR` in `src/db.ts`, `DB_PATH` (target: `~/.apsolut-cortex/memory.db`), `REGISTRY_PATH` (target: `~/.apsolut-cortex/registry.json`), `MODELS_DIR` (target: `~/.apsolut-cortex/models/`), README, hook paths, any tests or fixtures. The user is keeping the `apsolut-cortex` namespace deliberately so future `apsolut-*` projects (e.g. `apsolut-tokenoptimizer`) can sit alongside without collision. If a dev machine has an existing `~/.apsolut/` directory with a real DB, write a one-shot `apsolut-cortex migrate-namespace` command that moves the directory atomically (or document the manual `mv` if simpler).
- **Test framework:** wire up `bun:test` (built-in, no extra dep). Convention: `*.test.ts` colocated with source. Run via `bun test`. Add one trivial smoke test to confirm the runner works.
- **Migration system:** write a minimal migration runner. Schema:
  - `_migrations(id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`
  - Migration files: `src/migrations/NNN-name.ts` exporting `up(client)` and optionally `down(client)`
  - Runner walks the directory, applies any migration not in `_migrations`, wraps each in a transaction (`client.executeMultiple` or libSQL transaction API), takes a startup advisory lock so concurrent CLI/MCP processes don't race.
  - Convert existing `CREATE TABLE IF NOT EXISTS` calls in the codebase into migration files (one-shot conversion job, ~30–60 min). Existing schemas land as `001-initial-schema.ts`.
- **CHANGELOG:** create `CHANGELOG.md` at repo root, Keep-a-Changelog format. Add an entry for every milestone going forward.
- **Docs scaffolding:** create `docs/decisions/` (ADR home, format `NNN-title.md`), `docs/OPERATIONS.md`, `docs/STORAGE.md`, `docs/PROVIDERS.md`, `docs/CONFIG.md`, `docs/OLLAMA.md`. Each starts as a one-line placeholder; later milestones fill them in.

**Done when:** `bun test` runs (passing or failing — just runs), `apsolut-cortex migrate` applies the existing schema through the migration system idempotently, namespace rename is complete with no `~/.apsolut/` references remaining in the codebase, and CHANGELOG + docs/ scaffolding exist.

### Milestone 1 — Eval harness (do this first after pre-flight, do not skip)

- Create `evals/` at repo root.
- Add `evals/golden.jsonl` with the schema for 30 hand-labelable prompt/expected-retrieval pairs. Seed 5 example entries. Document format in `evals/README.md` and ask the user to fill the remaining 25.
- Add `apsolut-cortex eval run` CLI command. For each prompt: run retrieval, compare top-5 against expected, output hit rate, MRR, per-prompt diff.
- Add `shadow` mode: when `CORTEX_SHADOW=true`, compute what *would* have been retrieved but inject nothing. Log to `~/.apsolut-cortex/logs/shadow.jsonl`.
- Add `apsolut-cortex eval baseline` — snapshots current scores to `evals/baseline.json`. Subsequent runs report delta vs baseline.

**Done when:** `apsolut-cortex eval run` produces hit rate + MRR against the seeded 5 prompts and writes a baseline file.

### Milestone 2 — Retrieval audit log

- Every retrieval call writes one JSONL line to `~/.apsolut-cortex/logs/retrievals.jsonl`:
  `{ts, session_id, query, candidates: [{id, score_bm25, score_vector, score_rrf, score_mmr, tier, trust}], injected_ids, latency_ms}`
- Add `apsolut-cortex correct` slash command. User invokes it when Claude got something wrong. It tags the most recent retrieval entry as a miss. This is your cheapest labeled signal — collect it from day one.

**Done when:** retrieval log accumulates entries and `apsolut-cortex correct` annotates the most recent one.

### Milestone 3 — Encryption + backup (libSQL-native, non-negotiable)

The Phase 1 stack uses `@libsql/client`. libSQL has its own encryption and its own backup story — **do not** introduce SQLCipher (that's for vanilla SQLite via `better-sqlite3`).

- **Encryption at rest:** libSQL supports encryption via the `encryptionKey` option on `createClient`. Generate the key on first run, store via **`@napi-rs/keyring`** (not `keytar` — `keytar` was archived by Atom in Dec 2022 and is unmaintained). Key lives in OS keychain (Windows Credential Manager on native Windows, libsecret on WSL2 — note that WSL2 may need the `gnome-keyring` daemon running; document setup in `docs/OPERATIONS.md`).
- **Connection update:** every `createClient({ url, ... })` call now passes `encryptionKey`. Centralize client construction in `src/db.ts` so this is one place. If decryption fails, the brain is gone — design the bootstrap accordingly: prompt-and-cache on first run, fail-loud on key mismatch, never silently create a new DB.
- **Migration of the existing DB:** the existing unencrypted DB needs a one-shot re-encrypt. Use libSQL's dump → load pattern: `apsolut-cortex db re-encrypt` reads the existing DB, writes to a new encrypted DB, swaps atomically, archives the original. Backup the old DB to `~/.apsolut-cortex/backup/pre-encrypt-<ts>.db` first; do not delete until the user confirms.
- **Backup commands:** `apsolut-cortex backup` and `apsolut-cortex restore <snapshot>`.
  - For local file mode (what you're using): backup = atomic copy of the encrypted DB file (the file is encrypted at rest, so the file copy is the encrypted snapshot). Use `fs.copyFile` followed by `fsync` and atomic rename, or stage to a tempfile then rename.
  - Optionally: libSQL's own `db.dump()` produces a portable dump format if you want a logical (rather than physical) backup — useful for cross-version restoration. Add as `apsolut-cortex backup --logical`.
- **Nightly snapshot** via Windows Task Scheduler or WSL cron. Document the cron entry in `docs/OPERATIONS.md`. Rotation: keep last 7 daily, last 4 weekly, last 3 monthly. Snapshots land in `~/.apsolut-cortex/backup/`.
- **Multi-machine stance** (`docs/STORAGE.md`): single-machine local only. If you later want multi-machine, libSQL has a built-in sync-to-Turso path that's simpler than Litestream — but don't implement now.

**Done when:** existing DB is encrypted, `apsolut-cortex backup` produces a snapshot that `apsolut-cortex restore` can read in a clean WSL shell with only the OS keychain key, and nightly snapshot rotation is running.

### Milestone 4 — Range-linked memories + `memory_recall` tool

This milestone depends on the migration system from M0.

- Migration `004-range-linked-memories.ts`: add columns to `memories` table — `source_session_id TEXT`, `source_start_msg_idx INTEGER`, `source_end_msg_idx INTEGER`. Offsets are integer message indices into `raw_messages` (inclusive start, exclusive end).
- Migration `005-raw-messages.ts`: new table `raw_messages` indexed by `(session_id, msg_idx)`, append-only. Columns: `session_id TEXT`, `msg_idx INTEGER`, `role TEXT`, `content TEXT`, `created_at INTEGER`. Primary key `(session_id, msg_idx)`.
- **Retention:** `raw_messages` will grow unbounded — at heavy usage this is multi-GB per year. Add `CORTEX_RAW_RETENTION_DAYS` (default `90`) and a cleanup job that runs on `SessionEnd`: delete raw messages older than the threshold *only* for sessions whose memories have all been promoted to `is_pinned=true` (Milestone 8 introduces this flag — until then, retain all). This trades long-term recall fidelity for disk space and is the right default.
- Compression hook stores the source range alongside the compressed memory.
- New MCP tool `memory_recall(memory_id)` returns the linked raw message range. Tool description: *"use when a memory is ambiguous or you need the exact wording, tool output, or chronology that compression removed."*
- Existing memories get `source_*` set to `NULL` — no backfill required. The `memory_recall` tool returns a clear "no source linked — memory predates Milestone 4" message for those.

**Done when:** new memories have source ranges, `memory_recall` returns the raw chunk for them, and eval scores either improve or do not regress by more than **2 percentage points on hit rate or 0.02 on MRR** vs the Milestone 1 baseline. If they regress beyond that, do not ship — investigate first.

### Milestone 5 — Visibility layer (Obsidian-first, no web UI)

- `apsolut-cortex export` command writes one markdown file per memory to `~/.apsolut-cortex/obsidian/memories/`. YAML frontmatter: `tier, trust, weight, project, created_at, last_accessed, source_session_id, tags`. Body = memory content. `[[wiki-links]]` for project + tags.
- Auto-export on `SessionEnd` hook.
- Three curation commands: `apsolut-cortex promote <id>`, `apsolut-cortex demote <id>`, `apsolut-cortex tag <id> <tag>`.
- `apsolut-cortex grep <pattern>` — substring/regex search across memory content + metadata.
- `apsolut-cortex delete <id>` for single-memory removal. For bulk: `--project <n>`, `--tag <n>`, `--before <YYYY-MM-DD>`, `--grep <pattern>`. **Do not** accept raw SQL via CLI flag — shell-quoting plus arbitrary SQL is a footgun even for solo use. All bulk deletes prompt for confirmation showing affected count, with a `--yes` flag for scripting.
- **No web dashboard. No localhost server.** Obsidian + dataview is the dashboard.

**Done when:** memories appear as markdown in Obsidian vault on `SessionEnd`, dataview queries work against the frontmatter, three curation commands round-trip to libSQL, and all bulk-delete flags refuse to run without confirmation.

### Milestone 6 — In-session compression (Observer + Reflector + PreCompact)

The 2026 Claude Code hook surface lets you do this much better than session-end-only compression. **Verify your installed Claude Code version supports `PreCompact` and async hooks before designing the implementation.** Run `claude --version` and check the `/hooks` reference. Both shipped in Q1 2026 stable. If your installed version is older: upgrade Claude Code, or scope down — drop the `PreCompact` capture and rely on `PostToolUse` thresholds + `SessionEnd` only.

Three hooks together (when supported):

- **`PostToolUse`** with token-budget trigger: when conversation tokens exceed `CORTEX_OBSERVE_THRESHOLD` (default `30000`), enqueue compression on a **single-flight background worker** (one in-flight per session; subsequent triggers queue, never parallel — the model can't reason about the same conversation twice concurrently). Configure with `"async": true` so compression doesn't block tool execution.
- **`PreCompact`** hook: fires before Claude Code's own context compaction. Highest-value capture moment — Claude is about to lose context anyway. Force a synchronous, full-fidelity Observer run regardless of token threshold. This is your insurance against compaction-induced data loss.
- If conversation tokens cross `CORTEX_OBSERVE_THRESHOLD × CORTEX_OBSERVE_BLOCK_MULT` (default `1.2`, so 36000 with the default threshold) before the async worker completes, fall back to synchronous compression in `PostToolUse` itself. Safety net.
- Token estimation: fast local estimator (`tokenx` or `gpt-tokenizer`) — do not call the model just to count tokens.
- Compressed observations buffer and merge into the memory store on `SessionEnd`. Until then they live in an in-memory ring with disk spill if the process is killed mid-session (write to `~/.apsolut-cortex/buffer/<session_id>.jsonl`, deleted after merge).
- **Reflector layer:** when the compressed memory log exceeds `CORTEX_REFLECT_THRESHOLD` (default `40000` tokens), re-summarize into denser reflections. Two-tier compression. Reflector also runs on the single-flight worker, separate queue from observer.
- **Hook installation:** ship a `.claude/settings.json` template in the repo's `templates/` dir that wires up these events to invoke `apsolut-cortex hook <event>` with stdin JSON forwarded. Add `apsolut-cortex install-hooks` CLI to copy this into the user's project on demand.

**Done when:** long sessions show compressed memories landing in the store mid-session (visible via `apsolut-cortex grep` during the session), `PreCompact` triggers force a final capture before Claude Code compacts, and killed sessions resume from the spill file without losing buffered observations.

### Milestone 7 — Provider-agnostic, token-tiered model routing

The compression layer must not be hardcoded to Anthropic. cortex is a separate process from Claude Code — Claude Code uses Claude for *coding*, cortex uses *whatever you point it at* for compression. These are independent decisions.

**Use the Vercel AI SDK (`ai` package) as the provider abstraction.** It is the 2026 standard, supports every major provider (Anthropic, OpenAI, Google, Mistral, DeepSeek, Groq, Cerebras, Together, Fireworks, Moonshot, Cohere, xAI, Bedrock, Vertex, Ollama, LM Studio, and any OpenAI-compatible endpoint), and lets you switch providers by changing one string.

**Routing config schema (`CORTEX_COMPRESS_TIERS`, JSON):**

```json
[
  { "max_tokens": 5000,   "model": "ollama/llama3.2:3b",          "required": false },
  { "max_tokens": 30000,  "model": "anthropic/claude-haiku-4-5",  "required": true  },
  { "max_tokens": null,   "model": "anthropic/claude-sonnet-4-6", "required": true }
]
```

`max_tokens: null` is the catch-all top tier. `required: false` means "skip this tier if unavailable, fall through to next."

**Defaults (when no `CORTEX_COMPRESS_TIERS` is set):**

The router auto-builds a sensible table from whichever provider keys it finds in the environment:

- If Ollama reachable AND `CORTEX_OLLAMA_ENABLED != false` → Ollama gets the 0–5k tier.
- If `ANTHROPIC_API_KEY` present → Anthropic gets the middle and top tiers (Haiku for 5k–30k, Sonnet for 30k+).
- If `OPENAI_API_KEY` present but no Anthropic → OpenAI takes the same tiers (`gpt-4o-mini` for 5k–30k, `gpt-4o` for 30k+, or current 2026 equivalents).
- If `GOOGLE_API_KEY` present → Gemini Flash for middle, Gemini Pro for top.
- If multiple are present, prefer Anthropic (lowest variance vs your Claude Code coding sessions, useful for consistency).
- If none are present and Ollama is also unavailable → fail loud at startup with a config error pointing at `docs/PROVIDERS.md`.

**Health check + fallback:**

- On startup, probe each configured provider once. Cache reachability for `CORTEX_PROVIDER_RECHECK_MINUTES` (default `15`).
- A tier marked `required: false` is silently skipped if its provider fails the probe.
- A tier marked `required: true` that fails the probe → log a warning and merge its token range into the next required tier upward.
- Per-call: if a chosen provider returns an error (rate limit, network, auth), the existing Phase 1 circuit breaker takes over and routes the next call to the fallback chain.
- Routing decisions log to `~/.apsolut-cortex/logs/router.jsonl`: `{ts, input_tokens, chosen_model, reason}` where reason ∈ `tier-match | provider-unavailable-fallback | model-missing-fallback | circuit-breaker-fallback | required-tier-merged`.

**Provider-specific notes:**

- **Anthropic:** pin dated model strings (`claude-haiku-4-5-20251001`) so silent upgrades don't change behavior between eval runs.
- **OpenAI:** prefer the OpenAI-direct provider over compatibility shims unless you have a reason. For compression-sized jobs, GPT-4o-mini is roughly competitive with Haiku on cost.
- **Google Gemini:** Flash is genuinely cheap for compression and has a huge context window. Worth experimenting with for the top tier if cost matters more than provider consistency.
- **Groq / Cerebras:** very fast inference; use them when latency matters more than absolute quality (e.g., the `PostToolUse` async path).
- **Ollama:** opt-in via `CORTEX_OLLAMA_ENABLED=auto|true|false` (default `auto`). On Windows 11 + WSL2, `CORTEX_OLLAMA_URL` is `http://localhost:11434` if Ollama is in WSL, `http://host.docker.internal:11434` if it's on the Windows host. Document both in `docs/OLLAMA.md`. **If Ollama is not installed at all, set `CORTEX_OLLAMA_ENABLED=false` and the system runs Anthropic-only (or whatever else is configured) with no probe overhead and no warnings.**
- **OpenRouter / AI Gateway:** if you want a single API key for everything, route all tiers through `openrouter/<model>` — one credential, all providers.

**Configuration env vars:**

- `CORTEX_COMPRESS_TIERS` — JSON tier table override (full control)
- `CORTEX_OLLAMA_ENABLED` — `auto` (default) | `true` | `false`
- `CORTEX_OLLAMA_URL` — default `http://localhost:11434`
- `CORTEX_OLLAMA_MODEL` — default `llama3.2:3b`
- `CORTEX_PROVIDER_RECHECK_MINUTES` — default `15`
- Standard provider env vars (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_API_KEY`, `GROQ_API_KEY`, etc.) drive auto-config.

Document the full provider matrix in `docs/PROVIDERS.md`: which env var enables which provider, sane model picks per tier, and one-liner switch examples.

**Done when:** the router operates correctly under at least three configurations: (1) Anthropic-only, no Ollama installed, (2) Ollama + Anthropic, (3) OpenAI-only, no Anthropic, no Ollama. All three pass the eval suite within the Milestone 4 thresholds. Provider switching requires only env var changes — zero code changes.

### Milestone 8 — Simplification pass (do last)

**Run `apsolut-cortex backup` before any step in this milestone.** Trust collapse and taxonomy reduction are destructive and not reversible without a snapshot.

- Audit the ~16 `CORTEX_*` env vars (current count). Hard-code 80% to sane defaults. Expose ~5: thresholds, model routing, paths, log level. Document in `docs/CONFIG.md`.
- Collapse 4-tier trust (`observed → validated → proven → canonical`) to 2 tiers (`active`, `archived`) with `is_pinned` boolean. Migration: `observed`/`validated` → `active`, `proven`/`canonical` → `active` + `is_pinned=true`. Update auto-promotion logic: set `is_pinned` only after **≥3 retrievals AND zero `apsolut-cortex correct` signal within 7 days**. Note this is a heuristic — absence of correction doesn't prove correctness, it just means the user didn't complain. Acceptable until eval signal becomes the primary trust input.
- After 30 days of eval signal, audit the 5 tiers × 6 categories taxonomy. Anything with <5% of memories — collapse or remove.

---

## What you do NOT build

- **Code graph / tree-sitter / Leiden communities.** Deferred.
- **sqlite-vec migration.** Killed. libSQL has native vectors already in use; replacing them with sqlite-vec would require ripping out `@libsql/client` for `better-sqlite3`, losing native encryption, adding SQLCipher back, and rewriting the connection layer. Not worth it. If retrieval performance becomes a bottleneck, first tune libSQL: `EXPLAIN QUERY PLAN` on the slow queries, verify the embedding column has an appropriate index. Only consider migrating away from libSQL if eval signal proves the perf gap is material.
- **Web dashboard / localhost UI.** Killed.
- **Reviewer agent personas.** Killed.
- **Source adapters beyond Obsidian export.** Deferred.
- **350-line file limit.** Killed (replace with single-responsibility per module).
- **Package explosion / pnpm workspaces refactor.** Killed (also: project uses Bun, not pnpm).

---

## Automatic vs manual

**Automatic:**

- Export to markdown on `SessionEnd`
- Retrieval audit logging
- In-session compression buffering (`PostToolUse` async + `PreCompact` sync)
- Model tier routing
- Nightly backup
- Trust signal collection (`apsolut-cortex correct` annotations)

**Manual until eval signal proves otherwise:**

- Trust promotion to `is_pinned`
- Deletion
- Tag changes
- `memory_recall` invocation (the agent decides when, not always-on)

The auto-promotion path is the highest-risk component in the system. Until eval shows it's safe, lean conservative — promote only after multiple retrievals AND zero correction signal in the window.

---

## Definition of done, per milestone

- Tests passing (`bun test`).
- README updated for every new CLI command or MCP tool.
- One CHANGELOG entry per milestone with what changed and why.
- One-paragraph note in `docs/decisions/NNN-title.md` for any architectural choice beyond what this prompt specifies.
- Eval scores recorded in `evals/results/<milestone>.json` so we can detect regressions across milestones.

---

## Working style

Do not ask permission to refactor anything covered by this prompt. Do ask before:

- Adding a new dependency >100KB
- Adding a new external service or API
- Deferring a milestone for a "better" idea you thought of mid-flight
- Anything that would migrate away from libSQL (this is now a load-bearing architectural choice)

Deviations from the build order require a one-line justification logged in `docs/decisions/`. The plan is the plan.

Begin with Milestone 0.

---

## Fact-check notes (from codebase review)

### Confirmed matches
- Hook event names: SessionStart, PostToolUse, Stop, SessionEnd — correct PascalCase
- Hook config location: `~/.claude/settings.json` — correct
- Embedding model: Xenova/all-MiniLM-L6-v2, 384 dimensions — correct
- Compression: Claude Haiku (`claude-haiku-4-5-20251001`) primary, Ollama (`qwen2.5-coder:7b`) fallback — correct
- Circuit breaker: 3 failures, 1-hour cooldown — correct
- 5 memory tiers: episodic, semantic, procedural, strategic, meta — correct
- 6 categories: correction, insight, decision, discovery, fact, pattern — correct
- 4 trust tiers: observed, validated, proven, canonical — correct
- EMA-weighted decay + pruning — correct
- Hybrid retrieval: BM25 + cosine + RRF + MMR — correct
- Privacy tag stripping — correct

### Flagged concerns
- **M3 `@napi-rs/keyring` on WSL2:** keyring support is flaky, needs `gnome-keyring` daemon. Plan includes file-based fallback with `chmod 600`.
- **M4 `raw_messages` retention:** depends on M8's `is_pinned` flag. Use simple age-based retention until M8.
- **M6 `PreCompact` dependency:** verify Claude Code version supports it. Scoped-down version (PostToolUse + SessionEnd only) is viable fallback.
- **M7 Vercel AI SDK:** test Bun compatibility before committing.

### Key file reference
- CLI: `src/cli.ts` (387 lines)
- DB schema: `src/db.ts` (637 lines)
- MCP server: `src/mcp/server.ts` (457 lines)
- Compression: `src/compress.ts` (299 lines)
- Config: `src/config.ts` (108 lines)
- Embedding: `src/embed.ts` (24 lines)
- Privacy: `src/privacy.ts` (16 lines)
- Registry: `src/registry.ts` (48 lines)
- Hooks: `src/hooks/` (4 files)
- Build: `build.ts` (52 lines)
