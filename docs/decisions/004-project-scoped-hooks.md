# 004 — Hooks are per-project, and hooks buy their imports late

**Status:** accepted
**Date:** 2026-09-26

## Context

`init` registered cortex's hooks in `~/.claude/settings.json`, the user-global
scope. That made cortex run on every tool call in every project on the machine:
a Node process started, the bundle loaded `@libsql/client`, `gpt-tokenizer`,
`@huggingface/transformers` and the Anthropic SDK through hoisted ESM imports,
then read one path, found no `.apsolut-cortex/project.json`, and exited. Measured
with the shipped artifact: ~707 ms per invocation in a project that had never
heard of cortex, ~750 ms in an initialised one.

Two separate mistakes produced that number, and fixing either alone leaves most
of it. Global registration made unrelated projects pay at all; eager imports
made the early-exit path expensive. Per-project registration was already the
stated intent (a private decision record from 2026-07-03 says so) — the code
simply disagreed with it.

## Decision

**Scope.** Hooks are written to `<project>/.claude/settings.local.json`.
`settings.local.json` rather than `settings.json` because the entries reference a
locally installed binary and a `bun run /abs/path/cli.ts` command in dev mode;
neither belongs in a teammate's checkout. `init` additionally strips cortex's own
entries from `~/.claude/settings.json` so upgrading actually removes the tax, and
`uninstall` cleans all three scopes. `install-hooks --global` keeps machine-wide
registration available for anyone who wants it, with a printed warning.

**Imports.** A hook imports only `fs`/`path` (and dependency-free local modules)
at load time. Everything expensive is behind `await import()` placed after the
project check — and, where it makes sense, after the work is known to be needed:
the tokenizer only loads when a transcript is present, the compression pipeline
only when the token budget has actually been crossed. The external packages
themselves are lazily imported inside the modules that own them (`db.ts`,
`embed.ts`, `tokens.ts`, `compress.ts`), because a static ESM import is hoisted
by the runtime regardless of where the bundler places the module body — the
laziness has to exist at the dependency edge, not just at the local one.

Result: ~115 ms for a non-cortex invocation, which is bare Node startup.

## Consequences

- A project must run `init` to get memory. Nothing is implicit, which matches
  how the MCP server (`.mcp.json`, per project) already worked.
- Users upgrading from ≤ 0.13.x need one `apsolut-cortex init` (or
  `install-hooks`) per project they want memory in. `doctor` reports scope, so
  the state is discoverable rather than mysterious.
- Hook code is slightly less direct to read: destructured `await import()` at the
  point of use instead of a tidy import block. The comment at each site says why.
- Tests must not import a hook module to test its logic — importing it runs its
  stdin-reading `main()`. Pure logic that deserves tests moves out of the hook
  (as `extractCorrections` did, into `prompt-cues.ts`).
