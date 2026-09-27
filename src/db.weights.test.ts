/**
 * Weight EMA, trust promotion, decay and pruning — the machinery that decides
 * which memories survive. Previously untested, which is how the decay clock
 * bug below went unnoticed.
 */

import { describe, test, expect } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "./migrations/runner.js";
import { upsertProject, insertMemory, updateWeight, decayAndPrune, purgeRawMessages, insertRawMessage, upsertSession } from "./db.js";
import {
  CORTEX_WEIGHT_ALPHA, CORTEX_PROMOTE_USES, CORTEX_DECAY_DAYS,
  CORTEX_DECAY_OBSERVED,
} from "./config.js";

const DAY = 24 * 60 * 60 * 1000;

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  await upsertProject(db, { id: "p-1", name: "test" });
  return db;
}

function seed(db: Client, opts: Partial<{ trust: string; weight: number; content: string }> = {}) {
  return insertMemory(db, {
    project_id: "p-1", tier: "semantic", category: "fact",
    trust: opts.trust ?? "observed",
    content: opts.content ?? "a stable fact about the project",
    context: null, source: "test", embedding: null,
    weight: opts.weight ?? 1.0, session_id: null,
  });
}

async function readMemory(db: Client, id: string) {
  const r = await db.execute({
    sql: "SELECT weight, used_count, trust, last_decay_at FROM memories WHERE id = ?",
    args: [id],
  });
  return r.rows[0] as unknown as { weight: number; used_count: number; trust: string; last_decay_at: number | null };
}

describe("updateWeight EMA", () => {
  test("applies alpha * score/3 + (1-alpha) * weight", async () => {
    const db = await freshDb();
    const id = await seed(db, { weight: 1.0 });
    await updateWeight(db, id, 3, "p-1");
    const expected = CORTEX_WEIGHT_ALPHA * 1 + (1 - CORTEX_WEIGHT_ALPHA) * 1.0;
    expect((await readMemory(db, id)).weight).toBeCloseTo(expected, 6);
    db.close();
  });

  test("a zero score pulls the weight down", async () => {
    const db = await freshDb();
    const id = await seed(db, { weight: 1.0 });
    await updateWeight(db, id, 0, "p-1");
    expect((await readMemory(db, id)).weight).toBeCloseTo(1 - CORTEX_WEIGHT_ALPHA, 6);
    db.close();
  });

  test("promotes observed → validated after enough uses", async () => {
    const db = await freshDb();
    const id = await seed(db, { weight: 0.5 });
    for (let i = 0; i < CORTEX_PROMOTE_USES; i++) await updateWeight(db, id, 1, "p-1");
    const m = await readMemory(db, id);
    expect(m.used_count).toBe(CORTEX_PROMOTE_USES);
    expect(m.trust).toBe("validated");
    db.close();
  });

  test("never demotes a higher trust level", async () => {
    const db = await freshDb();
    const id = await seed(db, { trust: "canonical", weight: 2.0 });
    for (let i = 0; i < CORTEX_PROMOTE_USES + 1; i++) await updateWeight(db, id, 3, "p-1");
    expect((await readMemory(db, id)).trust).toBe("canonical");
    db.close();
  });
});

describe("decayAndPrune", () => {
  /** Backdate a memory so it is eligible for decay. */
  async function age(db: Client, id: string, days: number) {
    const when = Date.now() - days * DAY;
    await db.execute({
      sql: "UPDATE memories SET created_at = ?, last_decay_at = NULL, last_used = NULL WHERE id = ?",
      args: [when, id],
    });
  }

  test("decays an untouched memory once its window has passed", async () => {
    const db = await freshDb();
    const id = await seed(db, { weight: 1.0 });
    await age(db, id, CORTEX_DECAY_DAYS + 1);

    const first = await decayAndPrune(db, "p-1");
    expect(first.decayed).toBe(1);
    const after = await readMemory(db, id);
    expect(after.weight).toBeCloseTo(CORTEX_DECAY_OBSERVED, 6);
    expect(after.last_decay_at).not.toBeNull();
    db.close();
  });

  test("does not decay again within the same window", async () => {
    // The regression this guards: decay used to run on every SessionEnd, so a
    // memory nobody retrieved lost 5% per session rather than per week — ten
    // sessions a day drove it under the prune floor inside a week and deleted
    // it. `last_decay_at` gives decay its own clock.
    const db = await freshDb();
    const id = await seed(db, { weight: 1.0 });
    await age(db, id, CORTEX_DECAY_DAYS + 1);

    await decayAndPrune(db, "p-1");
    const once = (await readMemory(db, id)).weight;

    for (let i = 0; i < 20; i++) await decayAndPrune(db, "p-1");
    expect((await readMemory(db, id)).weight).toBeCloseTo(once, 6);
    db.close();
  });

  test("decays again once another window has elapsed", async () => {
    const db = await freshDb();
    const id = await seed(db, { weight: 1.0 });
    await age(db, id, CORTEX_DECAY_DAYS + 1);
    await decayAndPrune(db, "p-1");

    // Pretend the last decay happened a window ago.
    await db.execute({
      sql: "UPDATE memories SET last_decay_at = ? WHERE id = ?",
      args: [Date.now() - (CORTEX_DECAY_DAYS + 1) * DAY, id],
    });
    await decayAndPrune(db, "p-1");
    expect((await readMemory(db, id)).weight).toBeCloseTo(CORTEX_DECAY_OBSERVED ** 2, 6);
    db.close();
  });

  test("leaves recent memories alone", async () => {
    const db = await freshDb();
    const id = await seed(db, { weight: 1.0 });
    const result = await decayAndPrune(db, "p-1");
    expect(result.decayed).toBe(0);
    expect((await readMemory(db, id)).weight).toBe(1);
    db.close();
  });

  test("prunes below the floor but never proven or canonical", async () => {
    const db = await freshDb();
    const doomed = await seed(db, { weight: 0.05, content: "low value note" });
    const proven = await seed(db, { weight: 0.01, trust: "proven", content: "load-bearing fact" });

    const result = await decayAndPrune(db, "p-1");
    expect(result.pruned).toBe(1);
    const left = await db.execute("SELECT id FROM memories");
    const ids = left.rows.map((r) => r.id as string);
    expect(ids).toContain(proven);
    expect(ids).not.toContain(doomed);
    db.close();
  });
});

describe("purgeRawMessages", () => {
  test("deletes only rows older than the retention window", async () => {
    const db = await freshDb();
    await upsertSession(db, { id: "s-1", project_id: "p-1" });
    await insertRawMessage(db, {
      session_id: "s-1", msg_idx: 0, role: "user",
      content: "old", created_at: Date.now() - 100 * DAY,
    });
    await insertRawMessage(db, {
      session_id: "s-1", msg_idx: 1, role: "user",
      content: "recent", created_at: Date.now(),
    });

    expect(await purgeRawMessages(db, 90)).toBe(1);
    const left = await db.execute("SELECT content FROM raw_messages");
    expect(left.rows.map((r) => r.content)).toEqual(["recent"]);
    db.close();
  });

  test("a non-positive retention is a no-op, not a wipe", async () => {
    const db = await freshDb();
    await upsertSession(db, { id: "s-1", project_id: "p-1" });
    await insertRawMessage(db, {
      session_id: "s-1", msg_idx: 0, role: "user", content: "keep", created_at: 1,
    });
    expect(await purgeRawMessages(db, 0)).toBe(0);
    expect(await purgeRawMessages(db, -5)).toBe(0);
    expect(await purgeRawMessages(db, NaN)).toBe(0);
    expect((await db.execute("SELECT COUNT(*) AS n FROM raw_messages")).rows[0]?.n).toBe(1);
    db.close();
  });
});
