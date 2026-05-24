/**
 * Smoke tests for src/db.ts — verifies the `bun test` runner works
 * and that we can talk to an in-memory libSQL instance.
 *
 * Convention: *.test.ts files colocated with source. Run via `bun test`.
 */

import { describe, test, expect } from "bun:test";
import { createClient } from "@libsql/client";
import { cosineSimilarity } from "./db.js";

describe("cosineSimilarity", () => {
  test("returns 1.0 for identical unit vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([1, 0, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(1.0, 5);
  });

  test("returns 0 for orthogonal vectors", () => {
    const a = new Float32Array([1, 0, 0]);
    const b = new Float32Array([0, 1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  test("returns -1 for opposing vectors", () => {
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([-1, 0]);
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  test("returns 0 when one vector is all zeros", () => {
    const a = new Float32Array([0, 0, 0]);
    const b = new Float32Array([1, 1, 1]);
    expect(cosineSimilarity(a, b)).toBe(0);
  });
});

describe("in-memory libSQL", () => {
  test("can create an in-memory client and run a query", async () => {
    const client = createClient({ url: ":memory:" });
    const result = await client.execute("SELECT 1 + 1 AS sum");
    expect(result.rows[0]?.sum).toBe(2);
    client.close();
  });

  test("supports F32_BLOB and vector_distance_cos", async () => {
    const client = createClient({ url: ":memory:" });
    await client.execute(
      "CREATE TABLE v (id INTEGER PRIMARY KEY, emb F32_BLOB(3))"
    );
    await client.execute({
      sql: "INSERT INTO v (id, emb) VALUES (1, vector(?))",
      args: [JSON.stringify([1, 0, 0])],
    });
    const result = await client.execute({
      sql: "SELECT vector_distance_cos(emb, vector(?)) AS d FROM v WHERE id = 1",
      args: [JSON.stringify([1, 0, 0])],
    });
    expect(result.rows[0]?.d as number).toBeCloseTo(0, 5);
    client.close();
  });
});
