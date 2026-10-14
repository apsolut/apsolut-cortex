# Configuration

> M8 will audit and trim this list. Today there are ~21 `APSOLUT_CORTEX_*` env vars; M8 will hard-code most to sane defaults and expose ~5 at the top level.

Authoritative source: [`src/config.ts`](../src/config.ts). Grouped by concern:

**Duplicate detection**
- `APSOLUT_CORTEX_DUPLICATE_THRESHOLD` — `0.92` — cosine similarity floor for dedup at insert time.

**Decay & pruning**
- `APSOLUT_CORTEX_DECAY_DAYS` — `7` — days unused before decay starts, and the length of one decay window. A memory is decayed at most once per window (tracked per row in `memories.last_decay_at`), so decay rate does not depend on how many sessions you run.
- `APSOLUT_CORTEX_DECAY_OBSERVED` — `0.95` — per-window decay multiplier for `observed` trust.
- `APSOLUT_CORTEX_DECAY_VALIDATED` — `0.98` — per-window decay multiplier for `validated` trust.
- `APSOLUT_CORTEX_PRUNE_WEIGHT` — `0.1` — drop threshold (`proven`/`canonical` are never pruned).

**Search & ranking**
- `APSOLUT_CORTEX_RRF_K` — `60` — RRF fusion constant.
- `APSOLUT_CORTEX_MMR_LAMBDA` — `0.7` — relevance vs diversity (0–1).
- `APSOLUT_CORTEX_SEARCH_LIMIT_MAX` — `10` — max results returned to caller.
- `APSOLUT_CORTEX_SEARCH_MULTIPLIER` — `2` — overfetch multiplier before MMR.
- `APSOLUT_CORTEX_RECALL_TOKEN_BUDGET` — `4000` — ceiling on a single `memory_recall` response. Longer source ranges are truncated with an `offset` to resume from.

**Weight updates**
- `APSOLUT_CORTEX_WEIGHT_ALPHA` — `0.3` — EMA alpha.
- `APSOLUT_CORTEX_PROMOTE_WEIGHT` — `1.4` — weight that triggers promotion to `validated`.
- `APSOLUT_CORTEX_PROMOTE_USES` — `3` — use count that triggers promotion.
- `APSOLUT_CORTEX_BUMP_BOOST` — `0.1` — weight added on duplicate-detected.
- `APSOLUT_CORTEX_WEIGHT_CAP` — `3.0` — hard ceiling.

**Memory creation**
- `APSOLUT_CORTEX_CORRECTION_WEIGHT` — `1.5` — initial weight for `correction`-category memories.
- `APSOLUT_CORTEX_MANUAL_WEIGHT` — `1.2` — initial weight for explicit `memory_store` calls.

**Range-linked memories (M4)**
- `APSOLUT_CORTEX_RAW_RETENTION_DAYS` — `90` — days to keep `raw_messages` rows. Enforced on `SessionEnd` since 0.14.0: rows older than this are deleted regardless of whether a memory still points at them (`memory_recall` then reports the window as pruned). `<private>…</private>` blocks are stripped before a raw message is stored at all.

**In-session compression (M6 — only active with `install-hooks`)**
- `APSOLUT_CORTEX_OBSERVE_THRESHOLD` — `30000` — conversation tokens that fire a background compression run from `PostToolUse`.
- `APSOLUT_CORTEX_OBSERVE_BLOCK_MULT` — `1.2` — synchronous compression kicks in at `THRESHOLD × this` (default 36000) as a last-resort safety net.
- `APSOLUT_CORTEX_REFLECT_THRESHOLD` — `40000` — when this session's memories collectively exceed this token count, the reflector layer condenses them into denser meta-memories on `SessionEnd`.

**Prompt-time injection**
- `CORTEX_PROMPT_INJECT` — `1` — set to `0` to stop `UserPromptSubmit` from adding matching high-weight correction/decision memories to a prompt's context (max 2 per prompt, deduped per session).

**Eval (M1)**
- `APSOLUT_CORTEX_SHADOW` — `false` — when truthy (`true`/`1`/`yes`), `memory_search` runs retrieval but returns nothing to Claude. Would-be matches go to `~/.apsolut-cortex/logs/shadow.jsonl` instead. Useful for tuning retrieval against a real session without polluting context.

**Observation recovery**
- `APSOLUT_CORTEX_UNPROCESSED_BATCH` — `50` — how many stale observations one `SessionEnd` carries into compression. Bounded because the batch becomes a single provider prompt; raise it to drain a backlog accumulated while no provider was reachable (a project that ran for a while without one can hold hundreds, and at the default that is one session end per fifty).

**Provider keys / endpoints**
- `ANTHROPIC_API_KEY` — primary compression provider. Without it *and* without a reachable Ollama, no memories are formed — observations accumulate and compress later. **Set it in `~/.claude/settings.json` under `env`, not in a shell profile:** hooks are launched by Claude Code and inherit its environment, so a key that works in your terminal can be invisible to them. `apsolut-cortex doctor` reports what the hooks can actually see.
- `APSOLUT_CORTEX_ANTHROPIC_MODEL` — `claude-haiku-4-5-20251001` — compression model for the Anthropic path. Overridable so a retired model id does not break compression with no escape short of a release.
- `APSOLUT_CORTEX_OLLAMA_MODEL` — `qwen2.5-coder:7b` — Ollama model.
- `OLLAMA_HOST` — `http://localhost:11434` — Ollama server URL.
- Full provider matrix lands with M7; see [PROVIDERS.md](PROVIDERS.md).
