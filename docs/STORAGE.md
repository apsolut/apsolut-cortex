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
