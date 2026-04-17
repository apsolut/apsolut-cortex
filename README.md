# apsolut-cortex

Persistent memory for Claude Code projects.

Stores corrections, decisions, and patterns across sessions so Claude stops
repeating the same mistakes and forgetting what you decided last week.

---

## Install

```bash
npm install -g apsolut-cortex
```

## Per project

```bash
cd your-project
apsolut-cortex init
```

Restart Claude Code. Done.

---

## How it works

Sessions start clean — no context dumped automatically.
Memory is on demand. Say `"remember <topic>"` and Claude searches.

**During sessions (automatic):**
- Tool failures captured and stored
- Config file reads noted as discoveries
- Transcript scanned for self-corrections when Claude stops

**At session end (automatic):**
- Observations compressed into memories via Claude Haiku
- Fallback: Ollama if no API key
- Session summary stored for continuity
- Stale memories decay, low-value ones pruned over time

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

Override model: `CORTEX_OLLAMA_MODEL=llama3.1`
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
~/.apsolut/
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
| `CORTEX_DUPLICATE_THRESHOLD` | `0.92` | Cosine similarity threshold for dedup (0–1) |
| `CORTEX_DECAY_DAYS` | `7` | Days before unused memories start decaying |
| `CORTEX_DECAY_OBSERVED` | `0.95` | Weekly decay multiplier for observed-trust memories |
| `CORTEX_DECAY_VALIDATED` | `0.98` | Weekly decay multiplier for validated-trust memories |
| `CORTEX_PRUNE_WEIGHT` | `0.1` | Weight below which memories are pruned |
| `CORTEX_RRF_K` | `60` | RRF fusion constant |
| `CORTEX_MMR_LAMBDA` | `0.7` | MMR relevance vs diversity (0=diverse, 1=relevant) |
| `CORTEX_WEIGHT_ALPHA` | `0.3` | EMA alpha for weight updates |
| `CORTEX_PROMOTE_WEIGHT` | `1.4` | Weight threshold for trust promotion |
| `CORTEX_PROMOTE_USES` | `3` | Use count threshold for trust promotion |
| `CORTEX_BUMP_BOOST` | `0.1` | Weight bump on duplicate detection |
| `CORTEX_WEIGHT_CAP` | `3.0` | Maximum weight a memory can reach |
| `CORTEX_CORRECTION_WEIGHT` | `1.5` | Initial weight for correction memories |
| `CORTEX_MANUAL_WEIGHT` | `1.2` | Initial weight for manually stored memories |
| `CORTEX_SEARCH_LIMIT_MAX` | `10` | Maximum search results returned |
| `CORTEX_SEARCH_MULTIPLIER` | `2` | Overfetch multiplier for search ranking |
| `CORTEX_OLLAMA_MODEL` | `qwen2.5-coder:7b` | Ollama model for compression |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama server URL |
