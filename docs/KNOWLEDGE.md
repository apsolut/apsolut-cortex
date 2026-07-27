# KNOWLEDGE — memory-systems research notes

Survey of methodologies from the memory-systems literature, mapped against what
cortex already implements. This is a research backlog, not a commitment: when an
item ships, write an ADR in `docs/decisions/` and remove it from here.

Last reviewed: 2026-07-27.

## Already implemented (don't re-invent)

| Methodology | Where it lives |
|---|---|
| Hybrid retrieval (BM25 + vector) | `src/db.ts` — `searchBM25`, `searchVector` |
| Local embeddings (all-MiniLM-L6-v2, transformers.js) | `src/embed.ts` |
| Importance weighting + reinforcement on use | `src/db.ts` — `bumpWeight`, `updateWeight`, `CORTEX_WEIGHT_ALPHA` |
| Time decay, trust-scaled | `CORTEX_DECAY_DAYS`, `CORTEX_DECAY_OBSERVED/VALIDATED`, `CORTEX_PRUNE_WEIGHT` |
| Trust ladder (observed → validated → proven → canonical) | `src/curation.ts` |
| Per-session reflection / two-tier compression | `src/reflector.ts` (M6) |
| Near-duplicate merge at insert | `src/db.ts` — `findDuplicate` → `bumpWeight` |
| Retrieval logging with per-candidate ranks | `~/.apsolut-cortex/logs/retrievals.jsonl`, `src/logs.ts` |
| Eval harness with grep baseline | `evals/` — `golden.jsonl`, `baseline.json`, `runner.ts` |
| Manual contradiction/rating tools | MCP `memory_contradict`, `memory_rate` |

## Candidate methodologies

### A. Retrieval quality

Measurable via the existing eval harness — every item here should land with a
before/after delta on `evals/golden.jsonl`.

1. **Cross-encoder reranking.** Bi-encoder retrieval gets cheap top-20; a small
   local cross-encoder (e.g. `Xenova/ms-marco-MiniLM-L-6-v2`, same
   transformers.js stack as `embed.ts`) rescores top-20 → top-5. Most reliable
   precision win in the RAG literature; fully local.
2. **Asymmetric embeddings.** all-MiniLM-L6-v2 is symmetric, but the workload is
   asymmetric: terse `memory_search` queries vs verbose memory passages. Models
   with query/passage prefixes (bge-small, nomic-embed-text) target exactly
   this. Swap behind a flag, let the golden set decide.
3. **Explicit relevance/recency/importance fusion** (Generative Agents, Park et
   al. 2023): `score = α·relevance + β·recency + γ·importance`. All three
   signals already exist (vector distance, `last_used`, `weight`/trust) — fold
   them into ranking as tunable priors and grid-search α/β/γ against the golden
   set.

### B. Memory lifecycle

4. **Bi-temporal supersession** (Zep/Graphiti model). The insert-time
   near-neighbor check currently only handles the duplicate branch. Route the
   other branch: high semantic similarity + contradictory content =
   supersession candidate → set `valid_to` on the old memory and link it.
   "We use X" and "we moved to Y" stop competing at recall; history stays
   queryable but only the current fact injects.
5. **Cross-session consolidation ("sleep phase")** (MemGPT/Letta archival
   compaction). The reflector is per-session; the same fact learned across five
   sessions becomes five overlapping memories that pairwise dedup misses. A
   periodic offline pass clusters near-duplicates project-wide, merges into one
   canonical memory with provenance links, demotes the sources. Natural home:
   the existing compress-worker.
6. **Episodic / semantic / procedural split** (Reflexion). Repeated failures
   should graduate into imperative rules ("never run X without Y") that inject
   as guardrails regardless of query relevance; facts inject only when
   retrieved. The `tier` column is most of the schema already.

### C. Feedback loops

Biggest untapped asset: `retrievals.jsonl` records what was injected but nothing
about outcomes.

7. **Implicit relevance labels from retrieval logs.** Attribute outcomes: memory
   injected + user re-corrected the same thing that session = retrieval or
   content failure; session proceeded without re-correction = weak positive.
   Feeds the fusion weights in (3) and auto-`memory_rate` calls.
   *Infrastructure landed in 0.13.0:* observations now carry `prompt_id`
   (migration 005), so attribution can be per-prompt. The label pipeline
   itself is still to build.
8. **Correction detection in hooks.** Stop/post-tool-use hooks flag "user
   contradicted an injected memory mid-session" → auto-demote. The online
   learning loop Mem0/A-Mem converge on; cortex has the hook surface they lack.
   *First half landed in 0.13.0:* the `UserPromptSubmit` hook detects pushback
   cues (`src/prompt-cues.ts`) and stores correction observations BM25-linked
   to the likely-contradicted memory. Still to build: auto-demotion of the
   linked memory and supersession wiring (see item 4).

### D. Evaluation

9. **LongMemEval-style category coverage + abstention.** Extend `golden.jsonl`
   beyond retrieval hits: temporal reasoning ("what do we use *now*"), knowledge
   updates (supersession correctness), and abstention cases where the correct
   answer is *inject nothing* — the only way to tune the confidence threshold
   for skipping injection. Add a no-injection baseline next to the grep baseline
   to state cortex's per-session value honestly.

## Suggested order

(7) + (8) first — logging already exists and feedback data compounds. Then (1) —
small effort, guaranteed eval delta. Then (4)/(5) as the lifecycle deepens.

Out of scope regardless: code indexing / AST / LSP navigation — that is
graphify's territory; cortex stays a focused conversational-memory plugin.
