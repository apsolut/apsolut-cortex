---
name: remember
description: Search persistent project memory for past decisions, corrections, patterns, and context. Use when the user says "remember", "what do you know about", asks about past work, or needs context from previous sessions.
argument-hint: [topic]
---

Search project memory for relevant past context.

Use the `memory_search` MCP tool with the user's topic as the query. Present results clearly with category and content.

If no results found, suggest the user store something with `/apsolut-cortex:store`.

After presenting results, call `memory_rate` on any memories the user found useful (+1) or unhelpful (-1).

Query: $ARGUMENTS
