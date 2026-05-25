/**
 * Tests for curation helpers (promote/demote/tag/grep/delete).
 */

import { describe, test, expect } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "./migrations/runner.js";
import { upsertProject, insertMemory } from "./db.js";
import {
  promoteMemory,
  demoteMemory,
  tagMemory,
  untagMemory,
  getTagsForMemory,
  previewDeletion,
  applyDeletion,
  grepMemories,
  TRUST_ORDER,
} from "./curation.js";

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  await upsertProject(db, { id: "p-1", name: "test" });
  return db;
}

async function seed(db: Client, content: string, trust: "observed" | "validated" | "proven" | "canonical" = "observed"): Promise<string> {
  return insertMemory(db, {
    project_id: "p-1", tier: "semantic", category: "fact", trust,
    content, context: null, source: "test", embedding: null,
    weight: 1.0, session_id: null,
  });
}

describe("promote / demote", () => {
  test("promote walks observed → validated → proven → canonical", async () => {
    const db = await freshDb();
    const id = await seed(db, "promote-me");
    for (const expected of ["validated", "proven", "canonical"] as const) {
      const r = await promoteMemory(db, id);
      expect(r?.next).toBe(expected);
    }
    const top = await promoteMemory(db, id);
    expect(top?.changed).toBe(false); // already at top
    db.close();
  });

  test("demote walks back down and stops at observed", async () => {
    const db = await freshDb();
    const id = await seed(db, "demote-me", "proven");
    const a = await demoteMemory(db, id);
    expect(a?.next).toBe("validated");
    const b = await demoteMemory(db, id);
    expect(b?.next).toBe("observed");
    const c = await demoteMemory(db, id);
    expect(c?.changed).toBe(false);
    db.close();
  });

  test("missing id returns null", async () => {
    const db = await freshDb();
    expect(await promoteMemory(db, "nope")).toBeNull();
    db.close();
  });

  test("TRUST_ORDER export is the expected ladder", () => {
    expect(TRUST_ORDER).toEqual(["observed", "validated", "proven", "canonical"]);
  });
});

describe("tag / untag / getTagsForMemory", () => {
  test("round-trips tags, lower-cases them, ignores duplicates", async () => {
    const db = await freshDb();
    const id = await seed(db, "tag-me");
    expect(await tagMemory(db, id, "Architecture")).toBe(true);
    expect(await tagMemory(db, id, "ARCHITECTURE")).toBe(true); // INSERT OR IGNORE
    expect(await tagMemory(db, id, "security")).toBe(true);

    const tags = await getTagsForMemory(db, id);
    expect(tags).toEqual(["architecture", "security"]);

    expect(await untagMemory(db, id, "architecture")).toBe(true);
    expect(await getTagsForMemory(db, id)).toEqual(["security"]);

    db.close();
  });

  test("tag on missing memory returns false", async () => {
    const db = await freshDb();
    expect(await tagMemory(db, "nope", "x")).toBe(false);
    db.close();
  });
});

describe("grepMemories", () => {
  test("returns matching memories ordered by recency-ish, no embed needed", async () => {
    const db = await freshDb();
    await seed(db, "the libSQL choice is documented in ADR 001");
    await seed(db, "we use bun:test for unit tests");
    await seed(db, "another fact about libSQL native vectors");

    const hits = await grepMemories(db, "p-1", "libSQL", 10);
    expect(hits.length).toBe(2);
    db.close();
  });
});

describe("previewDeletion / applyDeletion", () => {
  test("rejects when no filter is provided", async () => {
    const db = await freshDb();
    let threw = false;
    try { await previewDeletion(db, {}); } catch { threw = true; }
    expect(threw).toBe(true);
    db.close();
  });

  test("single-id delete works", async () => {
    const db = await freshDb();
    const id = await seed(db, "delete-me");
    const preview = await previewDeletion(db, { id });
    expect(preview.count).toBe(1);
    const removed = await applyDeletion(db, { id });
    expect(removed).toBe(1);
    db.close();
  });

  test("tag filter selects memories carrying the tag", async () => {
    const db = await freshDb();
    const a = await seed(db, "keep me");
    const b = await seed(db, "drop me 1");
    const c = await seed(db, "drop me 2");
    await tagMemory(db, b, "trash");
    await tagMemory(db, c, "trash");

    const preview = await previewDeletion(db, { tag: "trash" });
    expect(preview.count).toBe(2);

    const removed = await applyDeletion(db, { tag: "trash" });
    expect(removed).toBe(2);

    const remaining = await db.execute("SELECT id FROM memories");
    expect(remaining.rows.map((r) => r.id as string)).toEqual([a]);

    // memory_tags should be GC'd
    const tags = await db.execute("SELECT COUNT(*) AS n FROM memory_tags");
    expect(tags.rows[0]?.n).toBe(0);
    db.close();
  });

  test("grep filter substring-matches content", async () => {
    const db = await freshDb();
    await seed(db, "the alpha approach");
    await seed(db, "an unrelated beta note");
    await seed(db, "more on alpha");

    const preview = await previewDeletion(db, { grep: "alpha" });
    expect(preview.count).toBe(2);
    db.close();
  });

  test("rejects invalid --before date", async () => {
    const db = await freshDb();
    let threw = false;
    try { await previewDeletion(db, { before: "not-a-date" }); } catch { threw = true; }
    expect(threw).toBe(true);
    db.close();
  });
});
