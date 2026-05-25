# 002 — Async in-session compression via detached workers

**Status:** accepted
**Date:** 2026-05-25

## Context

The original Phase 2 plan (M6) assumed Claude Code would expose an
`"async": true` hook flag so a long-running compression call would not
block tool execution. When we actually checked the docs (2.1.x), that
flag does not exist. Hooks have only `timeout` (60s default for command
hooks). A naïve PostToolUse hook that calls Anthropic and waits would
block every tool Claude runs by 5–15 seconds.

## Decision

Use the standard Unix detached-child pattern: PostToolUse hook spawns a
**detached background process** with `{ detached: true, stdio: "ignore" }`
and `.unref()`, then exits in milliseconds. The background process is
`apsolut-cortex hook:compress-worker`, which reads its job payload from
stdin (session id, cwd, transcript path) and runs the full compression
pipeline.

Mutual exclusion is enforced by a per-session lockfile under
`~/.apsolut-cortex/buffer/<session_id>.lock`. Same single-flight
pattern the migration runner already uses. Lock TTL is 5 minutes —
stale locks are cleared on next acquire.

A synchronous safety net runs *inside* PostToolUse when the conversation
token count exceeds `APSOLUT_CORTEX_OBSERVE_THRESHOLD ×
APSOLUT_CORTEX_OBSERVE_BLOCK_MULT` (default 30000 × 1.2 = 36000). At
that point we accept the tool-execution stall to make sure we capture
before Claude Code compacts on its own.

`PreCompact` (which Claude Code 2.x supports) runs synchronously and
waits up to 3 s for any in-flight worker to release the lock before
force-acquiring. This is the emergency capture moment.

## Consequences

**Positive:**

- Compression no longer blocks tool execution under normal load.
- No new infrastructure: lockfile, cursor file, JSONL spill — same
  primitives already used elsewhere in the codebase.
- Works in both dev (`bun run src/cli.ts`) and dist (`apsolut-cortex`)
  invocations because the spawned child uses `process.argv[0..2]` to
  re-invoke the dispatcher.
- The cursor file makes the worker idempotent and resumable across
  process kills — a half-finished compression cannot lose data because
  the source transcript is still on disk and the cursor only advances
  *after* memories are written.

**Negative:**

- Detached children on Windows have edge cases around stdio inheritance
  and the parent's console handle. We pass `stdio: ["pipe", "ignore",
  "ignore"]` and `.unref()` to minimize this, but a future user report
  of "compression never runs on Windows" should investigate this first.
- The synchronous safety-net branch (>1.2× threshold) is rare in
  practice but **does** stall tool execution while it runs. Acceptable
  as a last-resort safety net; we should add a metric in the retrieval
  log so we can see how often it fires.
- Lockfile-based mutual exclusion has known race windows. For a
  single-user single-machine tool this is fine; if cortex ever runs
  multi-process or multi-machine we'd want a real lock service.

## Rejected alternatives

- **Inline synchronous compression in PostToolUse.** Simplest, but 5–15
  second hangs on every tool call once the conversation hits 30K
  tokens. Rejected.
- **A long-lived daemon process** that hooks IPC into. More moving
  parts, more failure modes, harder to debug, no benefit at our scale.
  Rejected.
- **`spawn` with `stdio: "inherit"`.** Would leak the worker's stderr
  into the user's Claude Code session output. Rejected in favor of
  `"ignore"`.

## Migration path

Existing users (`apsolut-cortex init`) keep the legacy SessionEnd-only
hook set — nothing changes for them, no risk of regression.

New users (or existing users who opt in) run
`apsolut-cortex install-hooks` to wire the M6 hook set into
`~/.claude/settings.json`. The two are not mutually exclusive at the
file level — `install-hooks` strips any prior cortex entry before adding
the M6 commands.

A future release can flip the default by having `init` install the M6
hook set. Not for this milestone.
