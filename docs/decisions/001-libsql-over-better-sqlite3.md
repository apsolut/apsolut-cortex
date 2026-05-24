# 001 — libSQL over better-sqlite3

**Status:** accepted
**Date:** 2026-04 (codified retroactively from existing implementation)

## Context

apsolut-cortex needs a single-file, single-user SQL store with full-text search, vector similarity, encryption at rest, and a reasonable migration path. The two main candidates in the Bun/Node ecosystem are:

- `better-sqlite3` (synchronous, ubiquitous, requires extensions like `sqlite-vec` and SQLCipher for vectors and encryption respectively)
- `@libsql/client` (async, Turso's SQLite fork with native vector functions and built-in encryption)

## Decision

Use `@libsql/client` as the single DB driver. Do not introduce `better-sqlite3` even for "fast paths."

## Consequences

**Positive:**
- Native `F32_BLOB(N)` columns and `vector_distance_cos()` function — no `sqlite-vec` extension to compile or distribute.
- Built-in `encryptionKey` option on `createClient` — no SQLCipher dependency, no separate native build.
- Async-first API matches the rest of the codebase (Bun, MCP server, hooks).
- One driver to reason about; one connection layer to centralize in `src/db.ts`.

**Negative:**
- `@libsql/client` is younger than `better-sqlite3` and has a smaller community. Documentation gaps occasionally require reading the source.
- No native advisory locks; migration runner uses a sentinel-row pattern instead (good enough for single-machine single-user).
- Migrating away from libSQL later would require ripping out vector queries, encryption setup, and the connection layer. This is now a **load-bearing architectural choice** — call it out in any future "what should we change" discussion.

## Rejected alternatives

- **`better-sqlite3` + `sqlite-vec` + SQLCipher.** Three native dependencies, two of which need recompilation on every platform. Synchronous API would force us to either block the event loop or wrap every call. Killed.
- **Postgres + pgvector.** Overkill for single-user; would require running a server process.
- **Pure markdown files + grep.** Considered for M1 as a *baseline* in the eval harness (per Karpathy's pattern), but not as a replacement — we still want structured queries on `tier`, `trust`, `weight`, `last_used`, etc.
