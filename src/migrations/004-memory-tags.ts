/**
 * 004 — Memory tags
 *
 * User-applied free-form labels on individual memories. Used by:
 *   - `apsolut-cortex tag <id> <tag>` to add a tag
 *   - `apsolut-cortex delete --tag <name>` for bulk deletion
 *   - Obsidian export frontmatter (`tags: [...]`)
 *
 * Many-to-many: a memory can have multiple tags, a tag can be on many
 * memories. Append-only created_at lets us answer "when was this tag
 * applied?" later if we want a curation history view.
 */

import type { Client } from "@libsql/client";
import type { Migration } from "./runner.js";

const migration: Migration = {
  name: "004-memory-tags",

  async up(client: Client) {
    await client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS memory_tags (
        memory_id   TEXT NOT NULL,
        tag         TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        PRIMARY KEY (memory_id, tag)
      );

      CREATE INDEX IF NOT EXISTS idx_memory_tags_tag
        ON memory_tags(tag, memory_id);
    `);
  },
};

export default migration;
