# Ollama setup

> Filled in by M7. Until then, Ollama is the compression fallback when `ANTHROPIC_API_KEY` is missing or the Anthropic call fails.

Planned env vars:

- `APSOLUT_CORTEX_OLLAMA_ENABLED` — `auto` (default) | `true` | `false`. Set to `false` if Ollama is not installed and you do not want startup probe overhead.
- `APSOLUT_CORTEX_OLLAMA_URL` — default `http://localhost:11434`.
- `APSOLUT_CORTEX_OLLAMA_MODEL` — default `llama3.2:3b`.

## Windows 11 + WSL2

- Ollama running in WSL: `APSOLUT_CORTEX_OLLAMA_URL=http://localhost:11434`.
- Ollama on the Windows host (cortex in WSL): `APSOLUT_CORTEX_OLLAMA_URL=http://host.docker.internal:11434`.

## No Ollama installed

Set `APSOLUT_CORTEX_OLLAMA_ENABLED=false`. Compression runs Anthropic-only (or whichever other provider is configured) with no probe overhead and no warnings.
