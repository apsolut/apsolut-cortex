# Operations

Runbook for day-to-day operation of apsolut-cortex on a development machine.

> **Path invariant:** all data lives under `~/.apsolut-cortex/`. `~/.apsolut/` (without the `-cortex` suffix) is **reserved for other `apsolut-*` tools** and must never be touched by this plugin.

## Migrations

Run pending schema migrations:

```bash
apsolut-cortex migrate
```

Migrations also run automatically on every CLI/MCP startup, so manual invocation is rarely needed. Use it when bringing an older DB up to date without running the rest of the toolchain. See [STORAGE.md](STORAGE.md) for schema details.

## Backup & restore

> Filled in by M3. Until then: copy `~/.apsolut-cortex/memory.db` somewhere safe before any operation flagged "destructive" in this doc.

## Nightly snapshots

> Filled in by M3. Planned: Windows Task Scheduler entry + WSL cron entry; rotation policy = 7 daily / 4 weekly / 3 monthly under `~/.apsolut-cortex/backup/`.

## Audit (lint pass)

> Filled in by M8. Run weekly: `apsolut-cortex audit` reports near-duplicates, contradiction candidates, orphan tags, stale high-trust memories, and low-trust high-use memories. Read-only by default; `--apply` executes suggested merges/demotions.

## Provider health

> Filled in by M7. The compression router probes each configured provider on startup; tier merging and circuit-breaker fallback are documented there.

## Common issues

> Filled in as they're discovered.
