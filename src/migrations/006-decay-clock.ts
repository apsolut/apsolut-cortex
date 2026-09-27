/**
 * 006 — per-memory decay clock + retention index
 *
 * `decayAndPrune` ran on every SessionEnd and multiplied the weight of every
 * memory whose `last_used` was older than APSOLUT_CORTEX_DECAY_DAYS — which
 * includes every memory that has never been retrieved (`last_used IS NULL`).
 * The multiplier is documented as *weekly*, but it was applied once per
 * session end: at ten sessions a day an untouched memory crossed the prune
 * floor (0.1) in under a week and was deleted. Memories were disappearing on
 * a clock nobody intended.
 *
 * `last_decay_at` gives decay its own clock, independent of retrieval: a row
 * is only eligible once DECAY_DAYS have passed since it was last decayed
 * (falling back to created_at for pre-existing rows), and the column is
 * stamped when it is. Session frequency no longer affects decay rate.
 *
 * The raw_messages(created_at) index supports the retention purge, which
 * scans by age across all sessions.
 */

import type { Client } from "@libsql/client";
import type { Migration } from "./runner.js";

const migration: Migration = {
  name: "006-decay-clock",

  async up(client: Client) {
    // ADD COLUMN has no IF NOT EXISTS in SQLite. Databases that already
    // carry the column (a re-encrypt copy made after this shipped, a manual
    // patch) must not fail the whole migration chain.
    const cols = await client.execute("PRAGMA table_info(memories)");
    const hasColumn = cols.rows.some((r) => r.name === "last_decay_at");
    if (!hasColumn) {
      await client.execute("ALTER TABLE memories ADD COLUMN last_decay_at INTEGER");
    }

    await client.executeMultiple(`
      CREATE INDEX IF NOT EXISTS idx_mem_decay
        ON memories(project_id, last_decay_at);

      CREATE INDEX IF NOT EXISTS idx_raw_created
        ON raw_messages(created_at);
    `);
  },
};

export default migration;
