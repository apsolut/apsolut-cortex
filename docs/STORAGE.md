# Storage

apsolut-cortex stores everything under `~/.apsolut-cortex/`. Single-machine, single-user. libSQL (Turso's SQLite fork via `@libsql/client`) is the single source of truth.

> `~/.apsolut/` (no `-cortex` suffix) is reserved for other `apsolut-*` tools and must not be used.

## Directory layout

```
~/.apsolut-cortex/
├── memory.db          # libSQL database — primary store (encrypted iff `db re-encrypt` was run)
├── memory.db-wal      # libSQL WAL sidecar
├── memory.db-shm      # libSQL shared-memory sidecar
├── registry.json      # project id → name + path index
├── compression-state.json  # circuit-breaker state for the compression pipeline
├── models/            # downloaded embedding model files (Xenova/all-MiniLM-L6-v2, ~90 MB)
├── logs/              # retrievals.jsonl + corrections.jsonl + shadow.jsonl
├── backup/            # manual + pre-encrypt + pre-restore snapshots
├── buffer/            # per-session compression lock + cursor (M6)
└── obsidian/          # generated vault — see below
    ├── index.md           # TOC, grouped by project → category
    ├── _health.md         # curation hints (promote/demote candidates, flagged)
    ├── memories/          # one .md per memory (frontmatter + body + tag links)
    ├── by-category/       # one .md per category, sorted by weight
    └── by-project/        # one .md per project, grouped by category
```

The vault under `obsidian/` is fully regenerable from `memory.db` and is overwritten on every export — treat it as output, not state.

## Schema

Tables (current as of M6 + M5 rest):

| Table | Origin | Purpose |
|---|---|---|
| `_migrations` | M0 runner | Schema version tracking |
| `_migrations_lock` | M0 runner | Sentinel-row advisory lock during `runMigrations` |
| `projects` | 001 | Project registry (id, name, path) |
| `sessions` | 001 | One row per Claude Code session |
| `observations` | 001 | Raw signals captured by hooks (tool failures, file reads, corrections) before compression |
| `memories` | 001, extended by 002 | Compressed memories. M4 added `source_session_id` / `source_start_msg_idx` / `source_end_msg_idx` for `memory_recall`. |
| `memories_fts` | 001 | FTS5 virtual table over `memories` (porter ascii) |
| `file_hashes` | 001 | Per-project config-file hashes for change detection between sessions |
| `raw_messages` | 003 | Append-only transcript slices, indexed by `(session_id, msg_idx)`. Populated by M6 hooks; `memory_recall` reads from here. |
| `memory_tags` | 004 | M5 user-applied tags. Composite PK `(memory_id, tag)`, lowercased. Cascaded on memory delete. |

Migration files live in `src/migrations/NNN-name.ts` and are registered in `src/migrations/runner.ts`. Run `apsolut-cortex migrate` to apply pending migrations explicitly; they also run automatically on every CLI/MCP startup. See [OPERATIONS.md](OPERATIONS.md#migrations).

## Multi-machine / Turso cloud migration path

Not supported today by design (single-machine local). But the migration path is preserved by the driver choice: `@libsql/client` is the same driver Turso cloud uses, so moving to cloud later is a URL change, not a rewrite.

```ts
// today — local file, what every install runs
createClient({ url: `file:${DB_PATH}` })

// future: pure Turso cloud (online-only, no local file)
createClient({
  url: "libsql://<your-db>.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN,
})

// future: Turso cloud + local embedded replica (best of both)
//   reads stay local and fast, writes sync to cloud in the background,
//   second machine can connect to the same logical DB
createClient({
  url: `file:${DB_PATH}`,
  syncUrl: "libsql://<your-db>.turso.io",
  authToken: process.env.TURSO_AUTH_TOKEN,
})
```

All schema, vector queries (`F32_BLOB`, `vector_distance_cos`), FTS5, migrations, and encryption work identically against Turso cloud — it is libSQL. The only code change is the URL plus an optional `authToken`, both of which flow through the single `createClient` call in [`src/db.ts`](../src/db.ts).

Out of scope for Phase 2. When we want it, M3's encryption-at-rest work is the prerequisite (cloud-synced encrypted DB > cloud-synced plaintext).

## Encryption at rest

> Filled in by M3. libSQL-native `encryptionKey` + OS keychain via `@napi-rs/keyring`.
