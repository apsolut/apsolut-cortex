/**
 * Tests for M4 migrations (002, 003) plus the getMemoryWithRange helper.
 */

import { describe, test, expect } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "./runner.js";
import {
  insertMemory,
  insertRawMessage,
  getMemoryWithRange,
  upsertProject,
  upsertSession,
} from "../db.js";

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  return db;
}

describe("002-range-linked-memories", () => {
  test("adds source_* columns and the supporting index", async () => {
    const db = await freshDb();

    const cols = await db.execute("PRAGMA table_info(memories)");
    const names = cols.rows.map((r) => r.name as string);
    expect(names).toContain("source_session_id");
    expect(names).toContain("source_start_msg_idx");
    expect(names).toContain("source_end_msg_idx");

    const idx = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_mem_source_session'"
    );
    expect(idx.rows.length).toBe(1);

    db.close();
  });

  test("is idempotent — re-running the runner does not re-add columns", async () => {
    const db = await freshDb();
    // The IF NOT EXISTS PRAGMA check inside 002 lets it run twice safely
    // if for any reason runMigrations is re-entered.
    const result = await runMigrations(db);
    expect(result.applied).toEqual([]);
    db.close();
  });
});

describe("003-raw-messages", () => {
  test("creates the raw_messages table with composite primary key", async () => {
    const db = await freshDb();

    const tables = await db.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='raw_messages'"
    );
    expect(tables.rows.length).toBe(1);

    // Insert two messages and verify the composite PK accepts them.
    await db.execute({
      sql: "INSERT INTO raw_messages (session_id, msg_idx, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      args: ["sess-1", 0, "user", "hello", Date.now()],
    });
    await db.execute({
      sql: "INSERT INTO raw_messages (session_id, msg_idx, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
      args: ["sess-1", 1, "assistant", "hi", Date.now()],
    });

    const r = await db.execute("SELECT COUNT(*) AS n FROM raw_messages");
    expect(r.rows[0]?.n).toBe(2);

    // Duplicate (session_id, msg_idx) should violate PK.
    let threw = false;
    try {
      await db.execute({
        sql: "INSERT INTO raw_messages (session_id, msg_idx, role, content, created_at) VALUES (?, ?, ?, ?, ?)",
        args: ["sess-1", 0, "user", "duplicate", Date.now()],
      });
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);

    db.close();
  });
});

describe("insertMemory + getMemoryWithRange", () => {
  test("memory without source range gets NULL fields and recall returns empty raw list", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "test" });

    const id = await insertMemory(db, {
      project_id: "p-1",
      tier: "semantic",
      category: "fact",
      trust: "observed",
      content: "no source",
      context: null,
      source: "manual",
      embedding: null,
      weight: 1.0,
      session_id: null,
    });

    const result = await getMemoryWithRange(db, id);
    expect(result).not.toBeNull();
    expect(result?.memory.source_session_id).toBeNull();
    expect(result?.rawMessages).toEqual([]);

    db.close();
  });

  test("memory with source range returns the raw messages in order", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "test" });
    await upsertSession(db, { id: "sess-1", project_id: "p-1" });

    // Seed raw messages
    for (let i = 0; i < 5; i++) {
      await insertRawMessage(db, {
        session_id: "sess-1",
        msg_idx: i,
        role: i % 2 === 0 ? "user" : "assistant",
        content: `message ${i}`,
        created_at: Date.now() + i,
      });
    }

    // Memory pointing at messages [1, 4)
    const id = await insertMemory(db, {
      project_id: "p-1",
      tier: "episodic",
      category: "discovery",
      trust: "observed",
      content: "compressed memory of the middle of the conversation",
      context: null,
      source: "compression",
      embedding: null,
      weight: 1.0,
      session_id: "sess-1",
      source_session_id: "sess-1",
      source_start_msg_idx: 1,
      source_end_msg_idx: 4,
    });

    const result = await getMemoryWithRange(db, id);
    expect(result).not.toBeNull();
    expect(result?.rawMessages.length).toBe(3);
    expect(result?.rawMessages.map((m) => m.msg_idx)).toEqual([1, 2, 3]);
    expect(result?.rawMessages[0].content).toBe("message 1");

    db.close();
  });

  test("returns empty raw list when source range points outside available messages", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "test" });
    await upsertSession(db, { id: "sess-1", project_id: "p-1" });

    const id = await insertMemory(db, {
      project_id: "p-1",
      tier: "episodic",
      category: "fact",
      trust: "observed",
      content: "orphaned range",
      context: null,
      source: "compression",
      embedding: null,
      weight: 1.0,
      session_id: "sess-1",
      source_session_id: "sess-1",
      source_start_msg_idx: 100,
      source_end_msg_idx: 105,
    });

    const result = await getMemoryWithRange(db, id);
    expect(result?.rawMessages).toEqual([]);
    expect(result?.memory.source_session_id).toBe("sess-1");

    db.close();
  });

  test("insertRawMessage is idempotent via INSERT OR IGNORE", async () => {
    const db = await freshDb();
    await insertRawMessage(db, {
      session_id: "s", msg_idx: 0, role: "user", content: "a", created_at: 1,
    });
    // Second call with same (session_id, msg_idx) must not throw.
    await insertRawMessage(db, {
      session_id: "s", msg_idx: 0, role: "user", content: "a-prime", created_at: 2,
    });
    const r = await db.execute("SELECT content FROM raw_messages WHERE session_id='s' AND msg_idx=0");
    // Original wins (OR IGNORE).
    expect(r.rows[0]?.content).toBe("a");
    db.close();
  });
});
