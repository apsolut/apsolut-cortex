/**
 * 002 — Range-linked memories
 *
 * Adds three nullable columns to `memories` so a compressed memory can
 * point back at the raw conversation slice it was derived from:
 *
 *   source_session_id     — which session the memory came from
 *   source_start_msg_idx  — inclusive start index into raw_messages
 *   source_end_msg_idx    — exclusive end index
 *
 * Existing rows get NULL — they pre-date M4 and `memory_recall` returns
 * a clear "no source linked" message for them. The raw_messages table
 * itself is created by migration 003.
 */

import type { Client } from "@libsql/client";
import type { Migration } from "./runner.js";

const migration: Migration = {
  name: "002-range-linked-memories",

  async up(client: Client) {
    // SQLite cannot conditionally ALTER, so check pragma before each ADD.
    const cols = await client.execute("PRAGMA table_info(memories)");
    const have = new Set(cols.rows.map((r) => r.name as string));

    if (!have.has("source_session_id")) {
      await client.execute("ALTER TABLE memories ADD COLUMN source_session_id TEXT");
    }
    if (!have.has("source_start_msg_idx")) {
      await client.execute("ALTER TABLE memories ADD COLUMN source_start_msg_idx INTEGER");
    }
    if (!have.has("source_end_msg_idx")) {
      await client.execute("ALTER TABLE memories ADD COLUMN source_end_msg_idx INTEGER");
    }

    await client.execute(
      `CREATE INDEX IF NOT EXISTS idx_mem_source_session
       ON memories(source_session_id, source_start_msg_idx)`
    );
  },
};

export default migration;
