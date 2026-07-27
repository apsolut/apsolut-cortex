# 003 — Adopt native async hooks, keep the detached worker

**Status:** accepted
**Date:** 2026-07-27
**Amends:** [002 — Async in-session compression via detached workers](002-async-compression.md)

## Context

ADR-002 chose a detached-worker architecture because Claude Code hooks had
no async flag — a blocking PostToolUse hook would stall every tool call.
As of Claude Code 2.1.196 that premise is obsolete: command hooks support
`"async": true` (run in background, never block) and `"asyncRewake": true`
(run in background, wake Claude with the hook's stderr on exit code 2).
Verified against the hooks reference with Claude Code 2.1.220.

## Decision

Adopt the native flags in hook *registration*, but keep the detached
compress-worker in hook *code*:

- `PostToolUse`, `PostToolUseFailure`, `Stop` register with `async: true` —
  capture leaves the critical path entirely on new Claude Code.
- `PreCompact` registers with `asyncRewake: true` and exits 2 on
  compression failure, so a lost compaction window is surfaced to Claude
  instead of dying silently in stderr.
- `SessionStart` and `UserPromptSubmit` stay synchronous — they return
  context output, which async hooks cannot do.
- `SessionEnd` stays synchronous — an async hook racing Claude Code's own
  process exit could lose the end-of-session compression.

The detached worker spawn inside post-tool-use stays. Older Claude Code
ignores unknown hook fields and silently runs everything synchronously, so
the worker is still what keeps heavy compression off the tool path there.
Removing it would make `async: true` load-bearing — a silent perf
regression for anyone below 2.1.196. On new versions the spawn is a
harmless extra process fork inside an already-backgrounded hook.

## Consequences

- No minimum Claude Code version bump; behavior degrades gracefully.
- PreCompact failures now wake Claude (new versions) or surface stderr
  (old versions) instead of being silent.
- The worker can be deleted once we're comfortable requiring ≥ 2.1.196.
