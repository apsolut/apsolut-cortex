/**
 * Tests for the migration runner.
 *
 * Three scenarios cover the migration system's contract:
 *
 *   1. Fresh DB: all migrations apply, _migrations records them.
 *   2. Second run: idempotent — nothing applied, everything skipped.
 *   3. Pre-existing tables, no _migrations row (the "back-fill" case for
 *      databases that pre-date the migration system): the IF NOT EXISTS
 *      SQL is a no-op, the runner inserts the missing row, no data is lost.
 */

import { describe, test, expect } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { runMigrations, type Migration } from "./runner.js";
import initialSchema from "./001-initial-schema.js";

async function freshDb(): Promise<Client> {
  return createClient({ url: ":memory:" });
}

describe("runMigrations — fresh DB", () => {
  test("applies all migrations and records them in _migrations", async () => {
    const db = await freshDb();
    const result = await runMigrations(db);

    expect(result.applied).toContain("001-initial-schema");
    expect(result.skipped).toEqual([]);

    // _migrations row exists
    const rows = await db.execute("SELECT name FROM _migrations ORDER BY id");
    const names = rows.rows.map((r) => r.name as string);
    expect(names).toContain("001-initial-schema");

    // Tables created by 001 are usable
    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.rows.map((r) => r.name as string);
    expect(tableNames).toContain("memories");
    expect(tableNames).toContain("memories_fts");
    expect(tableNames).toContain("projects");
    expect(tableNames).toContain("sessions");
    expect(tableNames).toContain("observations");
    expect(tableNames).toContain("file_hashes");

    db.close();
  });
});

describe("runMigrations — idempotency", () => {
  test("second run is a no-op", async () => {
    const db = await freshDb();
    await runMigrations(db);
    const second = await runMigrations(db);

    expect(second.applied).toEqual([]);
    expect(second.skipped).toContain("001-initial-schema");

    db.close();
  });
});

describe("runMigrations — back-fill against pre-existing tables", () => {
  test("preserves data when tables already exist without _migrations row", async () => {
    const db = await freshDb();

    // Simulate a pre-migration DB: run 001's SQL directly, then insert data,
    // then run the migration system — it should not wipe anything.
    await initialSchema.up(db);
    await db.execute({
      sql: "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
      args: ["pre-existing-project", "legacy", "/tmp/legacy", Date.now()],
    });

    const result = await runMigrations(db);

    // 001 ran (the IF NOT EXISTS made it a no-op SQL-wise, but the row was inserted)
    expect(result.applied).toContain("001-initial-schema");

    // Pre-existing data survived
    const data = await db.execute("SELECT id FROM projects");
    expect(data.rows.map((r) => r.id as string)).toContain("pre-existing-project");

    db.close();
  });
});

describe("runMigrations — lock", () => {
  test("releases the lock after a successful run", async () => {
    const db = await freshDb();
    await runMigrations(db);

    const lockRows = await db.execute("SELECT * FROM _migrations_lock");
    expect(lockRows.rows.length).toBe(0);

    db.close();
  });

  test("rolls back and surfaces error when a migration fails", async () => {
    const db = await freshDb();
    const failing: Migration = {
      name: "999-deliberately-broken",
      async up(client) {
        await client.execute("SELECT this_function_does_not_exist()");
      },
    };

    let caught: Error | null = null;
    try {
      await runMigrations(db, [failing]);
    } catch (e) {
      caught = e as Error;
    }

    expect(caught).not.toBeNull();
    expect(caught?.message).toContain("999-deliberately-broken");

    // No partial record, lock released
    const recorded = await db.execute(
      "SELECT name FROM _migrations WHERE name = '999-deliberately-broken'"
    );
    expect(recorded.rows.length).toBe(0);

    const lockRows = await db.execute("SELECT * FROM _migrations_lock");
    expect(lockRows.rows.length).toBe(0);

    db.close();
  });
});
