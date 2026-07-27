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
    await client.executeMultiple(`
      ALTER TABLE observations ADD COLUMN prompt_id TEXT;
      CREATE INDEX IF NOT EXISTS idx_obs_prompt ON observations(prompt_id);
    `);
  },
};

export default migration;
