# Storage

apsolut-cortex stores everything under `~/.apsolut-cortex/`. Single-machine, single-user. libSQL (Turso's SQLite fork via `@libsql/client`) is the single source of truth.

> `~/.apsolut/` (no `-cortex` suffix) is reserved for other `apsolut-*` tools and must not be used.

## Directory layout

```
~/.apsolut-cortex/
├── memory.db          # libSQL database — primary store
├── registry.json      # project id → name + path index
├── models/            # downloaded embedding model files
├── logs/              # retrieval, shadow, router logs (jsonl)
├── backup/            # snapshots (filled in by M3)
├── buffer/            # in-flight compression spill (filled in by M6)
└── obsidian/          # markdown export (filled in by M5)
```

## Schema

Tables: `projects`, `sessions`, `observations`, `memories`, `memories_fts` (FTS5 virtual table over `memories`), `file_hashes`, and `_migrations` (schema version tracking).

Schema is defined in `src/migrations/*.ts`. Run `apsolut-cortex migrate` to apply pending migrations. See [OPERATIONS.md](OPERATIONS.md#migrations).

## Multi-machine

Not supported. If you want it later, libSQL has a built-in sync-to-Turso path that's simpler than Litestream. Out of scope for Phase 2.

## Encryption at rest

> Filled in by M3. libSQL-native `encryptionKey` + OS keychain via `@napi-rs/keyring`.
