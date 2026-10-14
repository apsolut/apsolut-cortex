/**
 * 005 — Observation prompt correlation
 *
 * Claude Code ≥ 2.1.196 sends a `prompt_id` UUID with every hook event,
 * identifying the user prompt being processed. Storing it on observations
 * lets the eval/feedback loop attribute a captured failure or correction
 * to the exact prompt that caused it (KNOWLEDGE.md item 7), instead of
 * only to the session.
 *
 * Nullable — hooks fired by older Claude Code versions simply leave it
 * empty.
 */

import type { Client } from "@libsql/client";
import type { Migration } from "./runner.js";

const migration: Migration = {
  name: "005-observation-prompt-id",

  async up(client: Client) {
    // SQLite cannot conditionally ALTER, so check the pragma first — the same
    // shape migrations 002 and 006 use, and the invariant runner.ts relies on
    // ("every migration here uses IF NOT EXISTS patterns so a partial run is
    // safe to retry"). This migration used to be a bare ADD COLUMN: the
    // column add and the `_migrations` row are separately auto-committed, so
    // a process killed between them left the column present and the
    // migration unrecorded, and every later startup died on "duplicate
    // column name: prompt_id". Hooks swallow startup failures, so memory
    // would have stayed silently broken forever.
    const cols = await client.execute("PRAGMA table_info(observations)");
    const have = new Set(cols.rows.map((r) => r.name as string));

    if (!have.has("prompt_id")) {
      await client.execute("ALTER TABLE observations ADD COLUMN prompt_id TEXT");
    }
    await client.execute(
      "CREATE INDEX IF NOT EXISTS idx_obs_prompt ON observations(prompt_id)"
    );
  },
};

export default migration;
