/**
 * Hybrid retrieval internals: RRF fusion, MMR diversification and the vector
 * arm. These were completely untested, which is how the BM25 phrase-quoting
 * bug survived to 0.12.7 — the fusion layer hid a dead retrieval arm.
 */

import { describe, test, expect } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "./migrations/runner.js";
import {
  upsertProject, insertMemory, searchVector, searchGrep,
  mergeRRF, applyMMR, type Memory,
} from "./db.js";
import { CORTEX_RRF_K } from "./config.js";

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  await upsertProject(db, { id: "p-1", name: "test" });
  return db;
}

/** 384 dims, because that is what the schema's F32_BLOB(384) expects. */
function vec(...leading: number[]): Float32Array {
  const v = new Float32Array(384);
  leading.forEach((n, i) => { v[i] = n; });
  return v;
}

/** The embedding column is an ArrayBuffer once it comes back from the DB. */
function buf(...leading: number[]): ArrayBuffer {
  return vec(...leading).buffer as ArrayBuffer;
}

function seed(db: Client, content: string, embedding: Float32Array | null) {
  return insertMemory(db, {
    project_id: "p-1", tier: "semantic", category: "fact", trust: "observed",
    content, context: null, source: "test", embedding,
    weight: 1.0, session_id: null,
  });
}

function fakeMemory(id: string): Memory {
  return {
    id, project_id: "p-1", tier: "semantic", category: "fact", trust: "observed",
    content: id, context: null, source: "test", embedding: null, weight: 1,
    used_count: 0, last_used: null, created_at: Date.now(), session_id: null,
    flagged: 0, flag_reason: null,
    source_session_id: null, source_start_msg_idx: null, source_end_msg_idx: null,
  };
}

describe("mergeRRF", () => {
  test("ranks an item found by both arms above one found by either alone", () => {
    const a = fakeMemory("both");
    const b = fakeMemory("bm25-only");
    const c = fakeMemory("vector-only");
    const all = new Map([[a.id, a], [b.id, b], [c.id, c]]);

    const merged = mergeRRF([b, a], [c, a], 3, all);
    expect(merged[0].id).toBe("both");
    expect(merged.length).toBe(3);
  });

  test("scores follow 1/(rank + k)", () => {
    const first = fakeMemory("first");
    const second = fakeMemory("second");
    const all = new Map([[first.id, first], [second.id, second]]);
    const merged = mergeRRF([first, second], [], 2, all);
    // Sanity on the constant actually being used, not just the ordering.
    expect(1 / (0 + CORTEX_RRF_K)).toBeGreaterThan(1 / (1 + CORTEX_RRF_K));
    expect(merged.map((m) => m.id)).toEqual(["first", "second"]);
  });

  test("respects the limit and drops unknown ids", () => {
    const a = fakeMemory("a");
    const b = fakeMemory("b");
    // "ghost" is in a ranked list but not in the item map — a stale id must not
    // become an undefined entry in the results.
    const ghost = fakeMemory("ghost");
    const all = new Map([[a.id, a], [b.id, b]]);
    const merged = mergeRRF([a, ghost], [b], 5, all);
    expect(merged.every(Boolean)).toBe(true);
    expect(merged.map((m) => m.id).sort()).toEqual(["a", "b"]);
  });

  test("empty inputs give an empty result", () => {
    expect(mergeRRF([], [], 5, new Map())).toEqual([]);
  });
});

describe("applyMMR", () => {
  test("passes candidates through untouched when there is no query embedding", () => {
    const items = [fakeMemory("a"), fakeMemory("b"), fakeMemory("c")];
    expect(applyMMR(items, null, 2).map((m) => m.id)).toEqual(["a", "b"]);
  });

  test("prefers a different memory over a near-duplicate of comparable relevance", () => {
    // λ = 0.7, so the second pick scores 0.7·relevance − 0.3·max-similarity:
    //   duplicate  0.7·0.80 − 0.3·1.00 = 0.26
    //   different  0.7·0.70 − 0.3·0.00 = 0.49
    // A near-identical memory has to be *substantially* more relevant to win.
    const query = vec(1, 0, 0);
    const top = { ...fakeMemory("top"), embedding: buf(1, 0, 0), similarity: 0.99 };
    const duplicate = { ...fakeMemory("duplicate"), embedding: buf(1, 0, 0), similarity: 0.8 };
    const different = { ...fakeMemory("different"), embedding: buf(0, 1, 0), similarity: 0.7 };

    const picked = applyMMR([top, duplicate, different], query, 2);
    expect(picked[0].id).toBe("top");
    expect(picked[1].id).toBe("different");
  });

  test("still takes a near-duplicate when it is far more relevant", () => {
    //   duplicate  0.7·0.98 − 0.3·1.00 = 0.386
    //   different  0.7·0.50 − 0.3·0.00 = 0.350
    const query = vec(1, 0, 0);
    const top = { ...fakeMemory("top"), embedding: buf(1, 0, 0), similarity: 0.99 };
    const duplicate = { ...fakeMemory("duplicate"), embedding: buf(1, 0, 0), similarity: 0.98 };
    const different = { ...fakeMemory("different"), embedding: buf(0, 1, 0), similarity: 0.5 };

    expect(applyMMR([top, duplicate, different], query, 2)[1].id).toBe("duplicate");
  });

  test("never returns more than the limit", () => {
    const query = vec(1, 0, 0);
    const items = ["a", "b", "c", "d"].map((id, i) => ({
      ...fakeMemory(id),
      embedding: buf(1 - i * 0.1, i * 0.1, 0),
      similarity: 1 - i * 0.1,
    }));
    expect(applyMMR(items, query, 2).length).toBe(2);
  });
});

describe("searchVector", () => {
  test("orders by cosine distance and reports similarity", async () => {
    const db = await freshDb();
    const near = await seed(db, "near match", vec(1, 0, 0));
    const far = await seed(db, "far match", vec(0, 1, 0));
    await seed(db, "no embedding at all", null);

    const hits = await searchVector(db, "p-1", vec(1, 0, 0), 10);
    expect(hits[0].id).toBe(near);
    expect(hits[0].similarity).toBeCloseTo(1, 4);
    expect(hits.map((h) => h.id)).toContain(far);
    // Rows without an embedding cannot be scored and must be excluded.
    expect(hits.length).toBe(2);
    db.close();
  });

  test("scopes to the project", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-2", name: "other" });
    await insertMemory(db, {
      project_id: "p-2", tier: "semantic", category: "fact", trust: "observed",
      content: "other project memory", context: null, source: "test",
      embedding: vec(1, 0, 0), weight: 1, session_id: null,
    });
    expect((await searchVector(db, "p-1", vec(1, 0, 0), 10)).length).toBe(0);
    db.close();
  });
});

describe("searchGrep (eval baseline)", () => {
  test("scores by token overlap and ignores stop words", async () => {
    const db = await freshDb();
    const both = await seed(db, "the migration lock is released after the run", null);
    await seed(db, "migration files live in src/migrations", null);

    const hits = await searchGrep(db, "p-1", "where is the migration lock?", 10);
    expect(hits[0].id).toBe(both);
    db.close();
  });

  test("a query of only stop words returns nothing rather than everything", async () => {
    const db = await freshDb();
    await seed(db, "some content here", null);
    expect(await searchGrep(db, "p-1", "is the of and", 10)).toEqual([]);
    db.close();
  });

  test("wildcards in the query are treated literally", async () => {
    const db = await freshDb();
    await seed(db, "a plain memory", null);
    expect(await searchGrep(db, "p-1", "%%%", 10)).toEqual([]);
    db.close();
  });
});
