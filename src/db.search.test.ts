/**
 * Tests for searchBM25 query tokenization (per-term OR matching).
 */

import { describe, test, expect } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "./migrations/runner.js";
import { upsertProject, insertMemory, searchBM25 } from "./db.js";

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  await upsertProject(db, { id: "p-1", name: "test" });
  return db;
}

async function seed(db: Client, content: string): Promise<string> {
  return insertMemory(db, {
    project_id: "p-1", tier: "semantic", category: "fact", trust: "observed",
    content, context: null, source: "test", embedding: null,
    weight: 1.0, session_id: null,
  });
}

describe("searchBM25", () => {
  test("matches non-adjacent terms", async () => {
    const db = await freshDb();
    const id = await seed(db, "The libsql encryption key is stored in the Windows Credential Manager");
    const hits = await searchBM25(db, "p-1", "libsql credential manager", 10);
    expect(hits.map((m) => m.id)).toContain(id);
    db.close();
  });

  test("matches natural-language questions", async () => {
    const db = await freshDb();
    const id = await seed(db, "The libsql encryption key is stored in the Windows Credential Manager");
    const hits = await searchBM25(db, "p-1", "where is the encryption key stored?", 10);
    expect(hits.map((m) => m.id)).toContain(id);
    db.close();
  });

  test("single-word query still matches", async () => {
    const db = await freshDb();
    const id = await seed(db, "The libsql encryption key is stored in the Windows Credential Manager");
    const hits = await searchBM25(db, "p-1", "encryption", 10);
    expect(hits.map((m) => m.id)).toContain(id);
    db.close();
  });

  test("query containing double quotes does not throw", async () => {
    const db = await freshDb();
    await seed(db, "say hello world");
    const hits = await searchBM25(db, "p-1", 'say "hello" world', 10);
    expect(Array.isArray(hits)).toBe(true);
    db.close();
  });

  test("empty and whitespace queries return [] without error", async () => {
    const db = await freshDb();
    await seed(db, "some content");
    expect(await searchBM25(db, "p-1", "", 10)).toEqual([]);
    expect(await searchBM25(db, "p-1", "   ", 10)).toEqual([]);
    db.close();
  });
});
