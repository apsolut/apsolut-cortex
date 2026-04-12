---
name: store
description: Explicitly save a memory to persistent storage. Use when the user says "store", "save this", "remember that", or wants to persist a decision, pattern, or important fact.
argument-hint: [content to store]
disable-model-invocation: true
---

Store a memory explicitly using the `memory_store` MCP tool.

Parse the user's input to determine:
- **content**: The fact, decision, or pattern to store
- **category**: One of `correction`, `decision`, `pattern`, `config`, or `note`
- **tier**: `explicit` (user-requested storage)

Confirm what was stored after saving.

Content to store: $ARGUMENTS
