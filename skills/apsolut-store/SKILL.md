---
name: apsolut-store
description: Explicitly save a memory to persistent storage. Use when the user says "store", "save this", "remember that", or wants to persist a decision, pattern, or important fact.
argument-hint: [content to store]
disable-model-invocation: true
---

Store a memory explicitly using the `memory_store` MCP tool.

Parse the user's input to determine:
- **content** (required): The fact, decision, or pattern — one clear sentence
- **category** (required): One of `correction`, `insight`, `decision`, `discovery`, `fact`, `pattern`
- **tier** (optional): `episodic` (specific event), `semantic` (general fact), `procedural` (how-to), `strategic` (architectural decision), or `meta` (how to work with this project). Defaults to `semantic`.
- **context** (optional): what was happening when the memory was captured

Only `content` and `category` are required. Do not invent other fields.

Confirm what was stored after saving.

Content to store: $ARGUMENTS
