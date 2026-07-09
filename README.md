# apsolut-cortex

> **Persistent memory for Claude Code.** Corrections, decisions, and patterns that survive across sessions — so Claude stops repeating mistakes and forgetting what you decided last week.

[![npm version](https://img.shields.io/npm/v/apsolut-cortex)](https://www.npmjs.com/package/apsolut-cortex)
[![node](https://img.shields.io/node/v/apsolut-cortex)](https://www.npmjs.com/package/apsolut-cortex)
[![license](https://img.shields.io/npm/l/apsolut-cortex)](LICENSE)

Claude Code forgets everything between sessions. `apsolut-cortex` gives it a
durable, local memory: it captures tool failures, decisions, and your
corrections as they happen, compresses them into concise memories at the end of
each session, and injects the relevant ones back at the start of the next. All
of it runs automatically through Claude Code hooks — install once, then forget
it's there.

Everything lives on your machine in a single SQLite-compatible database. Nothing
leaves except what you send to the Anthropic API for session compression (and
that step runs fully local if you use Ollama instead).

> **Standalone** — works on its own. Optional pairing:
> [apsolut-seshat](https://github.com/apsolut/apsolut-seshat) for a per-project
> markdown vault you curate by hand.

---

## Contents

- [Install](#install) · [Quick start](#quick-start) · [What's shipped](#whats-shipped)
- [How it works](#how-it-works) · [MCP tools](#mcp-tools) · [Commands](#commands)
- [Configuration](#configuration) · [Storage](#storage) · [Trust levels](#memory-trust-levels)
- [Troubleshooting](#troubleshooting) · [Project status](#project-status) · [Contributing](#contributing)

---

## Install

```bash
npm i -g apsolut-cortex
```

Then, in any project:

```bash
cd your-project
apsolut-cortex init
```

Restart Claude Code. Done.

**Requirements**

- **Node.js ≥ 20**
- **A compression provider** — set `ANTHROPIC_API_KEY`, or run [Ollama](#compression-providers)
  locally. Without one, cortex captures observations but fails loudly at session
  end instead of silently losing them.
- **On Windows**, hooks run through Git Bash. Slim/MinGit installs need one extra
  setting — see [Troubleshooting](#troubleshooting) (or just run
  `apsolut-cortex doctor`).

### Dev setup (contributors)

```bash
git clone https://github.com/apsolut/apsolut-cortex.git
cd apsolut-cortex
bun install && bun run build
npm link
```

---

## Quick start

After `init` and a restart, memory is fully automatic. To interact with it
directly, use the slash commands inside Claude Code:

```
/apsolut-recall <topic>     search memory
/apsolut-store  <content>   save something explicitly
/apsolut-status             show memory stats
/apsolut-forget <topic>     delete a wrong memory
```

Or from your shell:

```bash
apsolut-cortex status                 # what's stored for this project
apsolut-cortex grep "some pattern"    # substring search across memories
apsolut-cortex doctor                 # check hooks/env are healthy
```

---

## What's shipped

cortex is in active development. The core capture → compress → recall loop is
stable and used daily; a couple of newer capabilities are opt-in and explicitly
marked experimental. Nothing below is a promise — it either works today or it's
flagged. See [Project status](#project-status) for the honest caveats.

### ✅ Stable

| Capability | What it does |
|---|---|
| **Automatic capture** | Tool failures are stored, config-file reads are noted as discoveries, and the transcript is scanned for self-corrections when Claude stops. |
| **Session-start injection** | Last session summary + top relevant memories loaded at the start of every session; first session shows an onboarding guide. |
| **Session-end compression** | Observations are consolidated into memories via Claude Haiku (Ollama fallback), and a reflector pass merges large sessions into denser meta-memories. |
| **Hybrid retrieval** | BM25 + vector search, with a JSONL audit log of per-source ranks. `apsolut-cortex correct` flags the last retrieval as a miss and can store the fix in one gesture. |
| **Range-linked memories** | `memory_recall(id)` returns the raw conversation slice a compressed memory was derived from. |
| **Visibility layer** | `export` writes one markdown file per memory to an Obsidian-browseable vault, with compiled index / by-category / by-project / health views. Auto-exports on session end. |
| **Curation CLI** | `promote` / `demote` trust tiers, `tag` / `untag`, `grep`, and guarded single or bulk `delete` (every bulk delete previews and refuses without `--yes`). |
| **Backup & restore** | Snapshot the DB on demand; restore writes a safety snapshot first. |
| **MCP tools** | Six tools Claude can call directly (see [below](#mcp-tools)). |
| **Cross-platform setup** | Works on macOS, Windows, and WSL2. `apsolut-cortex doctor` diagnoses why hooks aren't firing. |

### 🧪 Experimental / opt-in

| Capability | Status |
|---|---|
| **Encryption at rest** | libSQL-native encryption via `db re-encrypt`, key stored in the OS keychain. Opt-in; default is plaintext. Works on Windows & macOS; **not supported on native Linux**. **Key loss = data loss** — always `backup` first. |
| **In-session compression** | Token-budget background worker + `PreCompact` safety capture, wired via `install-hooks`. Compresses mid-session without blocking tool execution. New; smoke-tested on limited hardware. |

### 🔜 Planned

- **Provider-agnostic routing** — Vercel AI SDK, token-tiered model routing, multi-provider health checks.
- **Simplification pass** — env-var audit, trust-tier collapse (4 → 2), taxonomy audit.

> Full build order: [docs/PHASE2-BUILD-ORDER.md](docs/PHASE2-BUILD-ORDER.md)

---

## How it works

Everything is automatic. Hooks fire across the Claude Code session lifecycle:

**Session start**
- Last session summary injected
- Top relevant memories loaded
- First session shows an onboarding guide

**During the session**
- Tool failures captured and stored
- Config-file reads noted as discoveries
- Transcript scanned for self-corrections when Claude stops

**Session end**
- Observations compressed into memories via Claude Haiku (Ollama fallback if no API key)
- Final transcript slice persisted to `raw_messages` so `memory_recall` can return real history
- Reflector pass consolidates large sessions into denser meta-memories
- Stale memories decay; low-value ones are pruned over time
- Vault auto-exported to `~/.apsolut-cortex/obsidian/`

**In-session** *(opt-in via `apsolut-cortex install-hooks`)*
- Token budget exceeded → detached background worker compresses mid-session, never blocking tool execution
- `PreCompact` event → synchronous safety capture right before Claude Code compacts its own context

---

## MCP tools

Tools Claude can call directly during a session:

| Tool | When |
|------|------|
| `memory_search(query)` | `/apsolut-recall`, or when Claude is uncertain |
| `memory_store(content, category, tier)` | After a decision or discovery |
| `memory_rate(id, score)` | After using a retrieved memory (0–3) |
| `memory_contradict(id, correction?)` | When a memory is wrong |
| `memory_status()` | Overview of what's stored |
| `memory_recall(id)` | Need the exact wording / chronology a memory was derived from |

---

## Commands

**Setup**
```bash
apsolut-cortex init             # set up memory for this project (legacy hook set)
apsolut-cortex install-hooks    # opt in to in-session compression (PreCompact + token-budget worker)
apsolut-cortex doctor           # diagnose why hooks aren't firing (Windows Git Bash, env, etc.)
apsolut-cortex uninstall        # remove hooks and MCP config (DB kept)
```

**Daily**
```bash
apsolut-cortex status           # show what's stored
apsolut-cortex grep <pattern>   # substring search across this project's memories
apsolut-cortex export           # write the Obsidian vault now (runs on session end too)
apsolut-cortex correct          # flag the most recent retrieval as a miss
apsolut-cortex correct --with "the correct answer"   # …and store the fix as a new memory
```

**Curation**
```bash
apsolut-cortex promote <id>             # walk trust tier up: observed → … → canonical
apsolut-cortex demote <id>              # walk it back down
apsolut-cortex tag <id> <tag>           # apply a free-form label
apsolut-cortex untag <id> <tag>
apsolut-cortex delete --id <id>
apsolut-cortex delete --project <id> --yes
apsolut-cortex delete --tag <name> --yes
apsolut-cortex delete --before YYYY-MM-DD --yes
apsolut-cortex delete --grep <pattern> --yes
# all bulk deletes show a preview and refuse without --yes
```

**Ops**
```bash
apsolut-cortex migrate                  # apply pending schema migrations
apsolut-cortex backup                   # snapshot DB under ~/.apsolut-cortex/backup/
apsolut-cortex restore                  # list snapshots
apsolut-cortex restore <path> --yes     # restore (writes a safety snapshot first)
apsolut-cortex db re-encrypt            # dry-run encryption migration plan
apsolut-cortex db re-encrypt --yes      # opt in to libSQL-native encryption at rest
```

**Eval** *(maintainer-only, run from a cloned repo)*
```bash
apsolut-cortex eval run                 # score hybrid vs grep retrieval against golden.jsonl
apsolut-cortex eval baseline            # snapshot scores for delta tracking
```

---

## Compression providers

Set one of these, or cortex will fail loudly at session end (observations are
kept and retried next session — nothing is lost):

**Option 1 — Anthropic API**
```bash
export ANTHROPIC_API_KEY="sk-ant-..."
```

**Option 2 — Ollama** (free, local, private)
```bash
ollama pull qwen2.5-coder:7b
ollama serve
```

Override the model with `APSOLUT_CORTEX_OLLAMA_MODEL=llama3.1`, or the host with
`OLLAMA_HOST=http://localhost:11434`. See [docs/OLLAMA.md](docs/OLLAMA.md).

---

## Configuration

All env vars use the `APSOLUT_CORTEX_` prefix and have sane defaults — most
people never set one. The five most commonly tweaked:

| Env var | Default | What it does |
|---|---|---|
| `ANTHROPIC_API_KEY` | _(unset)_ | Required for primary compression (Haiku). Without it, falls back to Ollama. |
| `APSOLUT_CORTEX_OBSERVE_THRESHOLD` | `30000` | Conversation tokens that fire mid-session compression. |
| `APSOLUT_CORTEX_DECAY_DAYS` | `7` | Days unused before a memory's weight starts decaying. |
| `APSOLUT_CORTEX_DUPLICATE_THRESHOLD` | `0.92` | Cosine similarity floor for the dedup-on-insert check. |
| `APSOLUT_CORTEX_SHADOW` | _(unset)_ | When truthy, retrieval logs to `~/.apsolut-cortex/logs/shadow.jsonl` without injecting. |

The full reference — all 21 vars, grouped by concern with descriptions and
trade-offs — lives in **[docs/CONFIG.md](docs/CONFIG.md)**.

---

## Storage

```
~/.apsolut-cortex/
  ├── memory.db       ← all memories, all projects, libSQL (Turso's SQLite fork)
  ├── registry.json   ← project registry
  ├── models/         ← embedding model cache (downloads once)
  ├── logs/           ← retrievals.jsonl, corrections.jsonl, shadow.jsonl
  ├── obsidian/       ← exported vault (regenerated on session end)
  ├── buffer/         ← per-session compression lock + cursor
  └── backup/         ← manual + pre-encrypt + pre-restore snapshots
```

All projects share one DB, namespaced by project UUID. No data leaves your
machine except what you send to the Anthropic API for session compression.

The on-disk format is libSQL — fully SQLite-compatible at the file level (any
`sqlite3` CLI can read it), with the option to migrate to Turso cloud later by
changing the connection URL alone. See [docs/STORAGE.md](docs/STORAGE.md) for the
migration path and full schema.

---

## Memory trust levels

```
observed → validated → proven → canonical
```

Memories start at `observed` and are promoted automatically as they prove
useful. Canonical memories never decay.

---

## Troubleshooting

### Windows: hooks not firing?

Claude Code runs command-type hooks through Git Bash. Its default detection
looks for bash at `<git>\usr\bin\bash.exe`. On a slim / MinGit-style Git for
Windows install only `<git>\bin\bash.exe` exists, so Claude Code can't launch
bash and **every cortex hook silently no-ops** with a non-blocking error like:

```
PostToolUse:Read hook error
Failed with non-blocking status code: Skipping command-line
'"C:\Program Files\Git\bin\..\usr\bin\bash.exe"'  (not found)
```

Because it's non-blocking, memory capture, session-start, stop, etc. all quietly
never run. Fix it by pointing Claude Code at the bash you do have — add to
`~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_GIT_BASH_PATH": "C:\\Program Files\\Git\\bin\\bash.exe" } }
```

then restart Claude Code. Run `apsolut-cortex doctor` to detect this
automatically and print the exact line (with your correct path) to paste; `init`
also warns about it at install time.

---

## Project status

cortex is in active Phase 2 development. Most surface area is solid; a few pieces
ship but are still being hardened. In brief:

- **Encryption — experimental.** Opt-in only; default is plaintext. Works cleanly
  on **Windows** (Credential Manager) and **macOS** (Keychain). **WSL2** needs
  `gnome-keyring-daemon` running with the `secrets` component. **Native Linux is
  not supported** — libSQL's local encryption errors with `SQLITE_IOERR` (the
  re-encrypt test suite is skipped on Linux CI), and `db re-encrypt` refuses
  there with a clear message instead of producing an unreadable database.
  **Key loss = data loss:** always run `backup` before enabling.
- **In-session compression — opt-in, new.** The token-budget worker + `PreCompact`
  hooks have only been smoke-tested on limited hardware. If a long session leaves
  stuck buffer files under `~/.apsolut-cortex/buffer/`, `migrate` clears the lock
  on next start; if compression itself fails, the session-end fallback still
  captures everything.
- **Eval signal — sparse.** The harness ships with 5 seed entries; the "is hybrid
  retrieval worth it?" question won't have a defensible answer until that grows to
  20+ paraphrased queries. The hybrid stack is the default until then.
- **Provider routing & simplification — deferred.** Compression is currently
  hardcoded to Anthropic Haiku → Ollama fallback, and the 4-tier trust ladder
  hasn't been collapsed yet.

If you're running cortex on a single dev machine with backups, none of this is
alarming. For a higher-stakes setting, wait for a 1.0 cut.

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, code
conventions, and migration-safety rules; [SECURITY.md](SECURITY.md) for
disclosure; and [CHANGELOG.md](CHANGELOG.md) for release history.

## License

[MIT](LICENSE)
