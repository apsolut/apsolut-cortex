# Compression providers

> Filled in by M7 (provider-agnostic, token-tiered routing via Vercel AI SDK).

Until then: compression uses Anthropic (`claude-haiku-4-5-20251001`) primary with Ollama fallback (`qwen2.5-coder:7b`). Configure via `ANTHROPIC_API_KEY`.

Planned matrix:

| Env var present | Tier 0–5k | Tier 5k–30k | Tier 30k+ |
|-----------------|-----------|-------------|-----------|
| Ollama only | local | local | local |
| `ANTHROPIC_API_KEY` | Ollama (if available) | Haiku | Sonnet |
| `OPENAI_API_KEY` (no Anthropic) | Ollama (if available) | gpt-4o-mini | gpt-4o |
| `GOOGLE_API_KEY` (no Anthropic) | Ollama (if available) | Gemini Flash | Gemini Pro |

Full routing config in `APSOLUT_CORTEX_COMPRESS_TIERS` (JSON tier table). See [PHASE2-BUILD-ORDER.md → M7](PHASE2-BUILD-ORDER.md) for the planned schema and fallback rules.
