# apsolut-cortex

Persistent memory for Claude Code projects.

Stores corrections, decisions, and patterns across sessions so Claude stops
repeating the same mistakes and forgetting what you decided last week.

## Pairs with apsolut-scaffolding (per-project vault)

Cortex is **cross-project, automatic, Claude-learned memory**.
For **per-project, intentional, human-curated markdown** (decisions, runbooks, fires, blueprints), see [apsolut-scaffolding](https://github.com/apsolut/apsolut-scaffolding).

The two are independent — use either or both. Cortex alone is fine for solo work and small repos. Add the scaffolding when a project grows enough to need a curated brain.

|                   | `~/.apsolut-cortex/` (this repo)                        | `.apsolut/` (scaffolding)                                |
|-------------------|---------------------------------------------------------|----------------------------------------------------------|
| **Scope**         | All projects                                            | This project                                             |
| **Lives in**      | `~/`, outside any repo                                  | The repo, with the code                                  |
| **Format**        | SQLite + embeddings                                     | Markdown files                                           |
| **Author**        | Claude, automatically                                   | You, intentionally                                       |
| **Lifecycle**     | observed → validated → proven → canonical               | inbox → explore → blueprint → tasks → done               |
| **Decay**         | Automatic (7 days)                                      | Manual (`/maintain`)                                     |
| **Retrieval**     | Hybrid vector + keyword via MCP                         | grep, wiki-links, Obsidian                               |
| **What goes here**| Corrections, tool failures, learned preferences — what Claude figured out the hard way | Decisions, runbooks, fires, services, rules — artifacts you curate |

**30-second decision rule:** *Did Claude learn it by getting corrected? → here. Did you write it for this project on purpose? → scaffolding.*

---

## Roadmap (Phase 2)

- [x] **M0 — Pre-flight (done):** namespace fixed to `~/.apsolut-cortex/` ✅ (`~/.apsolut/` is reserved for other `apsolut-*` tools and must never be used here), `bun:test` wired with smoke tests, migration system (`src/migrations/` + `_migrations` table + `apsolut-cortex migrate`), `CHANGELOG.md`, `docs/` scaffolding (OPERATIONS, STORAGE, PROVIDERS, CONFIG, OLLAMA, decisions/)
- [x] **M1 — Eval harness (done):** `evals/golden.jsonl` (5 seeded entries, target 30), reproducible fixture DB via `evals/fixtures/seed.ts`, `apsolut-cortex eval run` + `eval baseline` CLI, hybrid + grep retrieval scored side-by-side (Karpathy provocation testable), shadow mode (`APSOLUT_CORTEX_SHADOW=true` logs to `~/.apsolut-cortex/logs/shadow.jsonl` without injection)
- [ ] **M2 — Retrieval audit log:** JSONL retrieval logging, `correct` command for labeling misses
- [ ] **M3 — Encryption + backup:** libSQL-native encryption, OS keychain key storage, `backup` / `restore` commands, nightly rotation
- [ ] **M4 — Range-linked memories:** `raw_messages` table, source ranges on memories, `memory_recall` MCP tool
- [ ] **M5 — Visibility layer:** Obsidian markdown export, `promote` / `demote` / `tag` / `grep` / `delete` CLI commands
- [ ] **M6 — In-session compression:** `PostToolUse` async observer, `PreCompact` hook, buffer/spill system, reflector layer
- [ ] **M7 — Provider-agnostic routing:** Vercel AI SDK, token-tiered model routing, multi-provider health checks
- [ ] **M8 — Simplification pass:** env var audit, trust tier collapse (4 → 2), taxonomy audit

> Full plan: [docs/PHASE2-BUILD-ORDER.md](docs/PHASE2-BUILD-ORDER.md)

---

[![npm version](https://img.shields.io/npm/v/apsolut-cortex)](https://www.npmjs.com/package/apsolut-cortex)
[![license](https://img.shields.io/npm/l/apsolut-cortex)](LICENSE)

## Install

```bash
npm i -g apsolut-cortex
```

Then in any project:

```bash
cd your-project
apsolut-cortex init
```

Restart Claude Code. Done.

### Dev setup (contributors)

```bash
git clone https://github.com/apsolut/apsolut-cortex.git
cd apsolut-cortex
bun install && bun run build
npm link
```

---

## How it works

Everything is automatic. Hooks fire on every Claude Code session:

**Session start:**
- Last session summary injected
- Top relevant memories loaded
- First session shows onboarding guide

**During sessions:**
- Tool failures captured and stored
- Config file reads noted as discoveries
- Transcript scanned for self-corrections when Claude stops

**At session end:**
- Observations compressed into memories via Claude Haiku
- Fallback: Ollama if no API key
- Session summary stored for continuity
- Stale memories decay, low-value ones pruned over time

**On demand (slash commands):**
- `/apsolut-recall <topic>` — search memory
- `/apsolut-store <content>` — save something explicitly
- `/apsolut-status` — show memory stats
- `/apsolut-forget <topic>` — delete a wrong memory

---

## MCP tools Claude can call

| Tool | When |
|------|------|
| `memory_search(query)` | `/apsolut-recall` or Claude is uncertain |
| `memory_store(content, category, tier)` | After a decision or discovery |
| `memory_rate(id, score)` | After using a retrieved memory (0–3) |
| `memory_contradict(id, correction?)` | When a memory is wrong |
| `memory_status()` | Overview of what's stored |

---

## Compression providers

Set one of these or cortex will fail loudly at session end:

**Option 1 — Anthropic API**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Option 2 — Ollama (free, local, private)**
```bash
ollama pull qwen2.5-coder:7b
ollama serve
```

Override model: `APSOLUT_CORTEX_OLLAMA_MODEL=llama3.1`
Override host: `OLLAMA_HOST=http://localhost:11434`

---

## Commands

```bash
apsolut-cortex init        # set up memory for this project
apsolut-cortex status      # show what's stored
apsolut-cortex uninstall   # remove hooks and MCP config
```

---

## Storage

```
~/.apsolut-cortex/
  ├── memory.db       ← all memories, all projects, libSQL (Turso's SQLite fork)
  ├── registry.json   ← project registry
  └── models/         ← embedding model cache (downloads once)
```

All projects share one DB, namespaced by project UUID.
No data leaves your machine except what you send to the Anthropic API
for session compression.

The on-disk format is libSQL — fully SQLite-compatible at the file level
(any `sqlite3` CLI can read it), with the option to migrate to Turso cloud
later by changing the connection URL alone. See [docs/STORAGE.md](docs/STORAGE.md)
for the migration path.

---

## Memory trust levels

`observed` → `validated` → `proven` → `canonical`

Starts at observed. Promoted automatically as memories prove useful.
Canonical memories never decay.

---

## Configuration

All env vars use the `APSOLUT_CORTEX_` prefix. Defaults work well out of the box.

**Duplicate detection**
- `APSOLUT_CORTEX_DUPLICATE_THRESHOLD` — `0.92` — cosine similarity for dedup

**Memory decay**
- `APSOLUT_CORTEX_DECAY_DAYS` — `7` — days before unused memories decay
- `APSOLUT_CORTEX_DECAY_OBSERVED` — `0.95` — weekly decay for observed-trust
- `APSOLUT_CORTEX_DECAY_VALIDATED` — `0.98` — weekly decay for validated-trust
- `APSOLUT_CORTEX_PRUNE_WEIGHT` — `0.1` — weight below which memories are pruned

**Search & ranking**
- `APSOLUT_CORTEX_RRF_K` — `60` — RRF fusion constant
- `APSOLUT_CORTEX_MMR_LAMBDA` — `0.7` — relevance vs diversity (0–1)
- `APSOLUT_CORTEX_SEARCH_LIMIT_MAX` — `10` — max results returned
- `APSOLUT_CORTEX_SEARCH_MULTIPLIER` — `2` — overfetch multiplier

**Weight updates**
- `APSOLUT_CORTEX_WEIGHT_ALPHA` — `0.3` — EMA alpha for weight updates
- `APSOLUT_CORTEX_PROMOTE_WEIGHT` — `1.4` — weight threshold for promotion
- `APSOLUT_CORTEX_PROMOTE_USES` — `3` — use count for promotion
- `APSOLUT_CORTEX_BUMP_BOOST` — `0.1` — weight bump on duplicate
- `APSOLUT_CORTEX_WEIGHT_CAP` — `3.0` — max weight

**Memory creation**
- `APSOLUT_CORTEX_CORRECTION_WEIGHT` — `1.5` — initial weight for corrections
- `APSOLUT_CORTEX_MANUAL_WEIGHT` — `1.2` — initial weight for manual stores

**Compression**
- `APSOLUT_CORTEX_OLLAMA_MODEL` — `qwen2.5-coder:7b` — Ollama model
- `OLLAMA_HOST` — `http://localhost:11434` — Ollama server URL
