# Evals

Tiny eval harness to keep retrieval honest as we add complexity.

## What it measures

For each query in `golden.jsonl`, the runner executes retrieval and scores the top-5 results against an expected match. Two scores per retrieval:

- **Hit rate** — % of queries where any expected match appears in the top-5.
- **MRR** (Mean Reciprocal Rank) — `1 / rank_of_first_match`, averaged across queries.

Two retrieval functions run side by side:

1. **Hybrid** — the production path: BM25 + native vector cosine + RRF + MMR.
2. **Grep** — Karpathy baseline: naive substring match over `content` + `context`, recency-ordered.

If hybrid does not beat grep by **≥5 percentage points on hit rate**, we have license to simplify the retrieval stack in M8.

## golden.jsonl format

One JSON object per line:

```json
{
  "id": "g001",
  "query": "how do I encrypt the database?",
  "expected_patterns": ["encryption", "encryptionKey"],
  "expected_ids": ["uuid-here-optional"],
  "notes": "free text — what this query is testing"
}
```

- `id` — unique short identifier for this golden entry. Stable across runs.
- `query` — the prompt the user might say. Phrase naturally, not keyword-style.
- `expected_patterns` — array of substrings (case-insensitive). A retrieved memory counts as a hit if its `content` or `context` contains **any** of these.
- `expected_ids` — array of memory UUIDs (optional, used when targeting specific memories from a known fixture).
- `notes` — what this entry tests. Helps when reviewing regressions.

At least one of `expected_patterns` or `expected_ids` must be set.

## Running

```bash
# Against the seeded fixture DB (reproducible, no production data touched)
apsolut-cortex eval run

# Snapshot scores as the baseline
apsolut-cortex eval baseline

# Compare a subsequent run against the baseline
apsolut-cortex eval run --against baseline
```

The fixture DB is rebuilt in memory from `evals/fixtures/seed.ts` on every run. No persistent state. To eval against your real `~/.apsolut-cortex/memory.db`, pass `--db real` — useful for ad-hoc checks but not reproducible across machines, so do not commit baselines from that mode.

## Authoring more entries

We ship with 5 seed entries. Goal is 30 hand-labeled queries that exercise:

- Paraphrase matching (vector search should win)
- Keyword-heavy queries (BM25 should win)
- "Why" / motivation questions (semantic only)
- Specific value lookups ("what's the default for X")
- Negative cases (queries where no memory should match — score = miss is correct)

When adding entries, run `apsolut-cortex eval run` after each one to confirm the expected hit actually fires. If hybrid retrieval misses an entry you think it should hit, that's a bug worth filing — do not silently relax the expected_patterns to make the test pass.
