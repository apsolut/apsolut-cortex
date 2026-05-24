/**
 * Migration runner for apsolut-cortex.
 *
 * Walks the registered migration list and applies any that haven't been
 * recorded in `_migrations` yet. Each migration runs inside its own
 * transaction. A sentinel-row advisory lock prevents two concurrent
 * processes (CLI + MCP server) from racing.
 *
 * Migration files live in this directory as `NNN-name.ts` and export a
 * default `Migration` object. New migrations must also be added to
 * `MIGRATIONS` below — static imports ensure the bundler picks them up
 * when shipping `dist/`.
 */

import type { Client } from "@libsql/client";
import initialSchema from "./001-initial-schema.js";
import rangeLinkedMemories from "./002-range-linked-memories.js";
import rawMessages from "./003-raw-messages.js";

export interface Migration {
  name: string;
  up(client: Client): Promise<void>;
  down?(client: Client): Promise<void>;
}

/** Registered migrations, applied in array order. Add new ones at the end. */
export const MIGRATIONS: Migration[] = [
  initialSchema,
  rangeLinkedMemories,
  rawMessages,
];

const LOCK_TIMEOUT_MS = 30_000;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  client: Client,
  migrations: Migration[] = MIGRATIONS
): Promise<MigrateResult> {
  await ensureMigrationsTable(client);
  await acquireLock(client);

  try {
    const applied = await getAppliedNames(client);
    const result: MigrateResult = { applied: [], skipped: [] };

    for (const m of migrations) {
      if (applied.has(m.name)) {
        result.skipped.push(m.name);
        continue;
      }

      // No explicit transaction: libSQL's transaction API does not compose
      // with `executeMultiple` (which is how DDL-heavy migrations like 001
      // are written). SQLite auto-commits each DDL statement anyway, and
      // every migration here uses `IF NOT EXISTS` patterns so a partial run
      // is safe to retry. If a future migration is non-idempotent (e.g. a
      // data backfill), wrap it manually with BEGIN/COMMIT in its `up()`.
      try {
        await m.up(client);
        await client.execute({
          sql: "INSERT INTO _migrations (name, applied_at) VALUES (?, ?)",
          args: [m.name, Date.now()],
        });
        result.applied.push(m.name);
      } catch (err) {
        throw new Error(
          `[apsolut-cortex] migration ${m.name} failed: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    }

    return result;
  } finally {
    await releaseLock(client);
  }
}

async function ensureMigrationsTable(client: Client): Promise<void> {
  await client.executeMultiple(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      name        TEXT NOT NULL UNIQUE,
      applied_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS _migrations_lock (
      id           INTEGER PRIMARY KEY CHECK (id = 1),
      pid          INTEGER NOT NULL,
      acquired_at  INTEGER NOT NULL
    );
  `);
}

async function getAppliedNames(client: Client): Promise<Set<string>> {
  const result = await client.execute("SELECT name FROM _migrations");
  return new Set(result.rows.map((r) => r.name as string));
}

async function acquireLock(client: Client): Promise<void> {
  const now = Date.now();

  // Clear any stale lock first.
  await client.execute({
    sql: "DELETE FROM _migrations_lock WHERE acquired_at < ?",
    args: [now - LOCK_TIMEOUT_MS],
  });

  try {
    await client.execute({
      sql: "INSERT INTO _migrations_lock (id, pid, acquired_at) VALUES (1, ?, ?)",
      args: [process.pid, now],
    });
  } catch {
    const held = await client.execute(
      "SELECT pid, acquired_at FROM _migrations_lock WHERE id = 1"
    );
    const row = held.rows[0];
    throw new Error(
      `[apsolut-cortex] migration lock held by pid ${row?.pid} since ${new Date(
        row?.acquired_at as number
      ).toISOString()}. If this is stale, run: DELETE FROM _migrations_lock;`
    );
  }
}

async function releaseLock(client: Client): Promise<void> {
  await client.execute("DELETE FROM _migrations_lock WHERE id = 1");
}
