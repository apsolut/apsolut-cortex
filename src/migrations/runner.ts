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
import memoryTags from "./004-memory-tags.js";
import observationPromptId from "./005-observation-prompt-id.js";
import decayClock from "./006-decay-clock.js";

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
  memoryTags,
  observationPromptId,
  decayClock,
];

/** Age after which a lock row is assumed abandoned by a dead process. */
const LOCK_TIMEOUT_MS = 30_000;
/** How long a starting process waits for a live lock before giving up. */
const LOCK_WAIT_MS = 5_000;
const LOCK_RETRY_MS = 50;

export interface MigrateResult {
  applied: string[];
  skipped: string[];
}

export async function runMigrations(
  client: Client,
  migrations: Migration[] = MIGRATIONS
): Promise<MigrateResult> {
  await ensureMigrationsTable(client);

  // Fast path: when every migration is already on record there is nothing to
  // serialize, so skip the lock entirely. getDb() runs this on every hook
  // invocation and the lock is an INSERT+DELETE pair — two WAL writes paid
  // for a guaranteed no-op, plus a needless chance to collide with a
  // concurrent process.
  const preApplied = await getAppliedNames(client);
  if (migrations.every((m) => preApplied.has(m.name))) {
    return { applied: [], skipped: migrations.map((m) => m.name) };
  }

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

/**
 * Take the advisory lock, waiting for a live holder instead of failing on
 * first contention. Hooks, the MCP server and the CLI all open the DB at
 * once on a cold start; a single INSERT attempt made one of them die with
 * an error, and if the winner had already released the lock the error message
 * read "held by pid undefined since Invalid Date" because the follow-up
 * SELECT found nothing.
 */
async function acquireLock(client: Client): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  let holder: string | null = null;

  for (;;) {
    const now = Date.now();

    // Clear any abandoned lock (process died mid-migration) first.
    await client.execute({
      sql: "DELETE FROM _migrations_lock WHERE acquired_at < ?",
      args: [now - LOCK_TIMEOUT_MS],
    });

    try {
      await client.execute({
        sql: "INSERT INTO _migrations_lock (id, pid, acquired_at) VALUES (1, ?, ?)",
        args: [process.pid, now],
      });
      return;
    } catch {
      // Contended. Record who has it (may be nobody by now — the holder can
      // release between our INSERT failing and this SELECT, in which case the
      // next iteration simply wins).
      const held = await client.execute(
        "SELECT pid, acquired_at FROM _migrations_lock WHERE id = 1"
      );
      const row = held.rows[0];
      if (row) {
        holder = `pid ${row.pid} since ${new Date(Number(row.acquired_at)).toISOString()}`;
      }
      if (Date.now() >= deadline) break;
      await new Promise((r) => setTimeout(r, LOCK_RETRY_MS));
    }
  }

  throw new Error(
    `[apsolut-cortex] migration lock still held after ${LOCK_WAIT_MS}ms` +
      `${holder ? ` (${holder})` : ""}. If this is stale, run: DELETE FROM _migrations_lock;`
  );
}

async function releaseLock(client: Client): Promise<void> {
  await client.execute("DELETE FROM _migrations_lock WHERE id = 1");
}
