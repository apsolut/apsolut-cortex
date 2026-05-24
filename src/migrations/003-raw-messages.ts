/**
 * 003 — raw_messages table
 *
 * Append-only store of raw conversation turns, indexed by (session_id,
 * msg_idx). Memories created by compression (M6) will record source
 * ranges into this table so `memory_recall` can return exact wording
 * when the compressed memory is ambiguous.
 *
 * Retention: APSOLUT_CORTEX_RAW_RETENTION_DAYS (default 90). The cleanup
 * job lands with M8's is_pinned work; until then all rows are retained.
 */

import type { Client } from "@libsql/client";
import type { Migration } from "./runner.js";

const migration: Migration = {
  name: "003-raw-messages",

  async up(client: Client) {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS raw_messages (
        session_id  TEXT NOT NULL,
        msg_idx     INTEGER NOT NULL,
        role        TEXT NOT NULL,
        content     TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (session_id, msg_idx)
      );

      CREATE INDEX IF NOT EXISTS idx_raw_session_time
        ON raw_messages(session_id, created_at);
    `);
  },
};

export default migration;
