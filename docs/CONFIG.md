# Configuration

> Audited and trimmed in M8. Today there are ~16 `APSOLUT_CORTEX_*` env vars; M8 will hard-code 80% of them and expose ~5.

Current env vars are defined in [`src/config.ts`](../src/config.ts). Grouped by concern:

- **Duplicate detection:** `APSOLUT_CORTEX_DUPLICATE_THRESHOLD`
- **Decay & pruning:** `APSOLUT_CORTEX_DECAY_DAYS`, `APSOLUT_CORTEX_DECAY_OBSERVED`, `APSOLUT_CORTEX_DECAY_VALIDATED`, `APSOLUT_CORTEX_PRUNE_WEIGHT`
- **Search & ranking:** `APSOLUT_CORTEX_RRF_K`, `APSOLUT_CORTEX_MMR_LAMBDA`, `APSOLUT_CORTEX_SEARCH_LIMIT_MAX`, `APSOLUT_CORTEX_SEARCH_MULTIPLIER`
- **Weight updates:** `APSOLUT_CORTEX_WEIGHT_ALPHA`, `APSOLUT_CORTEX_PROMOTE_WEIGHT`, `APSOLUT_CORTEX_PROMOTE_USES`, `APSOLUT_CORTEX_BUMP_BOOST`, `APSOLUT_CORTEX_WEIGHT_CAP`
- **Memory creation:** `APSOLUT_CORTEX_CORRECTION_WEIGHT`, `APSOLUT_CORTEX_MANUAL_WEIGHT`

Provider-related env vars (`ANTHROPIC_API_KEY`, `APSOLUT_CORTEX_OLLAMA_URL`, etc.) are documented in [PROVIDERS.md](PROVIDERS.md).

Eval-related env vars added by M1: `APSOLUT_CORTEX_SHADOW` (shadow-mode retrieval logging without injection).
