/**
 * Tests for backup, restore, and re-encryption against isolated temp DBs.
 * Never touches the user's real ~/.apsolut-cortex/memory.db.
 *
 * The re-encryption round-trip is the critical test: write known data
 * into a plaintext DB, re-encrypt it with a key, verify the data round-
 * trips when reopened with the key, and verify it is unreadable without.
 */

import { describe, test, expect, afterAll, beforeEach } from "bun:test";
import { existsSync, mkdtempSync, rmSync, unlinkSync, copyFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createClient } from "@libsql/client";
import { runMigrations } from "./migrations/runner.js";
import { reencryptPathToKey } from "./backup.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "apsolut-cortex-backup-test-"));
const tempDbs: string[] = [];

function tempDbPath(name: string): string {
  const p = join(tmpRoot, `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  tempDbs.push(p);
  return p;
}

afterAll(() => {
  for (const p of tempDbs) {
    for (const ext of ["", "-wal", "-shm", ".new"]) {
      const path = `${p}${ext}`;
      if (existsSync(path)) { try { unlinkSync(path); } catch {} }
    }
  }
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe("reencryptPathToKey — round trip", () => {
  test("re-encrypts a populated DB and the data round-trips with the key", async () => {
    const path = tempDbPath("roundtrip");

    // Step 1: populate an unencrypted DB with known data via the migration
    // system + direct inserts.
    {
      const src = createClient({ url: `file:${path}` });
      await runMigrations(src);
      await src.execute({
        sql: "INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)",
        args: ["p-1", "test-project", "/tmp/test", Date.now()],
      });
      await src.execute({
        sql: "INSERT INTO memories (id, project_id, tier, category, trust, content, source, weight, used_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["m-1", "p-1", "semantic", "fact", "validated", "the canary memory", "test", 1.0, 0, Date.now()],
      });
      src.close();
    }

    // Step 2: re-encrypt.
    const key = "test-key-1234567890abcdef-fixed-for-this-test";
    const result = await reencryptPathToKey(path, key);
    expect(result.rows_copied.projects).toBe(1);
    expect(result.rows_copied.memories).toBe(1);

    // Step 3: reopen with the key — data should round-trip.
    {
      const dst = createClient({ url: `file:${path}`, encryptionKey: key });
      const r = await dst.execute("SELECT content FROM memories WHERE id = 'm-1'");
      expect(r.rows[0]?.content).toBe("the canary memory");
      const p = await dst.execute("SELECT name FROM projects WHERE id = 'p-1'");
      expect(p.rows[0]?.name).toBe("test-project");
      dst.close();
    }

    // Step 4: reopen WITHOUT the key — should fail.
    {
      const noKey = createClient({ url: `file:${path}` });
      let threw = false;
      try {
        await noKey.execute("SELECT * FROM memories");
      } catch {
        threw = true;
      }
      expect(threw).toBe(true);
      try { noKey.close(); } catch {}
    }
  });

  test("FTS5 search still works after re-encryption", async () => {
    const path = tempDbPath("fts");
    {
      const src = createClient({ url: `file:${path}` });
      await runMigrations(src);
      await src.execute({
        sql: "INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)",
        args: ["p-1", "fts-test", Date.now()],
      });
      await src.execute({
        sql: "INSERT INTO memories (id, project_id, tier, category, trust, content, source, weight, used_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ["m-1", "p-1", "semantic", "fact", "validated", "encryption protects memories at rest", "test", 1.0, 0, Date.now()],
      });
      src.close();
    }

    const key = "fts-test-key";
    await reencryptPathToKey(path, key);

    const dst = createClient({ url: `file:${path}`, encryptionKey: key });
    const r = await dst.execute({
      sql: "SELECT m.id FROM memories_fts JOIN memories m ON m.rowid = memories_fts.rowid WHERE memories_fts MATCH ? AND m.project_id = ?",
      args: ["encryption", "p-1"],
    });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0]?.id).toBe("m-1");
    dst.close();
  });

  test("preserves data when source has no rows", async () => {
    const path = tempDbPath("empty");
    {
      const src = createClient({ url: `file:${path}` });
      await runMigrations(src);
      src.close();
    }
    const key = "empty-test-key";
    const result = await reencryptPathToKey(path, key);
    expect(result.rows_copied.memories).toBe(0);
    expect(result.rows_copied.projects).toBe(0);

    const dst = createClient({ url: `file:${path}`, encryptionKey: key });
    const r = await dst.execute("SELECT COUNT(*) as n FROM memories");
    expect(r.rows[0]?.n).toBe(0);
    dst.close();
  });
});
