# apsolut-cortex

Persistent memory for Claude Code projects.

Stores corrections, decisions, and patterns across sessions so Claude stops
repeating the same mistakes and forgetting what you decided last week.

---

## Roadmap (Phase 2)

- [x] **M0 — Pre-flight:** namespace rename (`~/.apsolut/` → `~/.apsolut-cortex/`) ✅, `bun:test` setup, migration system, CHANGELOG, docs scaffolding
- [ ] **M1 — Eval harness:** golden set, `eval run` command (hit rate + MRR), shadow mode, baseline snapshots
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
git clone https://github.com/apsolut-repo/apsolut-cortex.git
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

**On demand:**
- Say `"remember <topic>"` to search memory
- Say `"store this"` to save something explicitly

---

## MCP tools Claude can call

| Tool | When |
|------|------|
| `memory_search(query)` | User says "remember X" or Claude is uncertain |
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
  ├── memory.db       ← all memories, all projects, SQLite
  ├── registry.json   ← project registry
  └── models/         ← embedding model cache (downloads once)
```

All projects share one DB, namespaced by project UUID.
No data leaves your machine except what you send to the Anthropic API
for session compression.

---

## Memory trust levels

`observed` → `validated` → `proven` → `canonical`

Starts at observed. Promoted automatically as memories prove useful.
Canonical memories never decay.

---

## Configuration

All thresholds are tunable via environment variables. Defaults work well out of the box.

| Variable | Default | Description |
|----------|---------|-------------|
| `APSOLUT_CORTEX_DUPLICATE_THRESHOLD` | `0.92` | Cosine similarity threshold for dedup (0–1) |
| `APSOLUT_CORTEX_DECAY_DAYS` | `7` | Days before unused memories start decaying |
| `APSOLUT_CORTEX_DECAY_OBSERVED` | `0.95` | Weekly decay multiplier for observed-trust memories |
| `APSOLUT_CORTEX_DECAY_VALIDATED` | `0.98` | Weekly decay multiplier for validated-trust memories |
| `APSOLUT_CORTEX_PRUNE_WEIGHT` | `0.1` | Weight below which memories are pruned |
| `APSOLUT_CORTEX_RRF_K` | `60` | RRF fusion constant |
| `APSOLUT_CORTEX_MMR_LAMBDA` | `0.7` | MMR relevance vs diversity (0=diverse, 1=relevant) |
| `APSOLUT_CORTEX_WEIGHT_ALPHA` | `0.3` | EMA alpha for weight updates |
| `APSOLUT_CORTEX_PROMOTE_WEIGHT` | `1.4` | Weight threshold for trust promotion |
| `APSOLUT_CORTEX_PROMOTE_USES` | `3` | Use count threshold for trust promotion |
| `APSOLUT_CORTEX_BUMP_BOOST` | `0.1` | Weight bump on duplicate detection |
| `APSOLUT_CORTEX_WEIGHT_CAP` | `3.0` | Maximum weight a memory can reach |
| `APSOLUT_CORTEX_CORRECTION_WEIGHT` | `1.5` | Initial weight for correction memories |
| `APSOLUT_CORTEX_MANUAL_WEIGHT` | `1.2` | Initial weight for manually stored memories |
| `APSOLUT_CORTEX_SEARCH_LIMIT_MAX` | `10` | Maximum search results returned |
| `APSOLUT_CORTEX_SEARCH_MULTIPLIER` | `2` | Overfetch multiplier for search ranking |
| `APSOLUT_CORTEX_OLLAMA_MODEL` | `qwen2.5-coder:7b` | Ollama model for compression |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
