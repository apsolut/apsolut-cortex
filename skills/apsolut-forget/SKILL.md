---
name: apsolut-forget
description: Delete a wrong or outdated memory. Use when the user says "forget", "that's wrong", "delete that memory", or wants to correct stored information.
argument-hint: [topic or memory ID]
disable-model-invocation: true
---

Delete an incorrect or outdated memory using the `memory_contradict` MCP tool.

Steps:
1. If the user gave a topic (not an ID), first search with `memory_search` to find matching memories
2. Show the matches and confirm which one to delete
3. Call `memory_contradict` with the memory ID
4. If the user provides a correction, include it as the replacement

Topic or ID: $ARGUMENTS
