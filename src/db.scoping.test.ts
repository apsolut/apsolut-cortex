/**
 * Project isolation on the memory write/read paths.
 *
 * One database holds every project on the machine, and memory IDs are visible
 * to the model (search results), to the exported Obsidian vault and to the
 * retrieval logs. Every id-addressed operation must therefore be scoped, or a
 * session in project A can delete, rate or read the source transcript of a
 * memory in project B.
 */

import { describe, test, expect } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "./migrations/runner.js";
import {
  upsertProject, upsertSession, insertMemory, insertRawMessage,
  updateWeight, deleteMemory, getMemoryWithRange,
} from "./db.js";

async function twoProjects(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  await upsertProject(db, { id: "p-a", name: "alpha" });
  await upsertProject(db, { id: "p-b", name: "beta" });
  return db;
}

function seed(db: Client, projectId: string, content: string, extra: Record<string, unknown> = {}) {
  return insertMemory(db, {
    project_id: projectId, tier: "semantic", category: "fact", trust: "observed",
    content, context: null, source: "test", embedding: null,
    weight: 1.0, session_id: null, ...extra,
  });
}

describe("updateWeight", () => {
  test("rates a memory in the caller's own project", async () => {
    const db = await twoProjects();
    const id = await seed(db, "p-a", "alpha memory");
    expect(await updateWeight(db, id, 3, "p-a")).toBe(true);
    const row = await db.execute({ sql: "SELECT weight, used_count FROM memories WHERE id = ?", args: [id] });
    expect(row.rows[0]?.used_count).toBe(1);
    db.close();
  });

  test("refuses a memory belonging to another project and changes nothing", async () => {
    const db = await twoProjects();
    const id = await seed(db, "p-b", "beta memory");
    expect(await updateWeight(db, id, 3, "p-a")).toBe(false);
    const row = await db.execute({ sql: "SELECT weight, used_count, last_used FROM memories WHERE id = ?", args: [id] });
    expect(row.rows[0]?.weight).toBe(1);
    expect(row.rows[0]?.used_count).toBe(0);
    expect(row.rows[0]?.last_used).toBeNull();
    db.close();
  });

  test("returns false for an unknown id", async () => {
    const db = await twoProjects();
    expect(await updateWeight(db, "no-such-id", 2, "p-a")).toBe(false);
    db.close();
  });
});

describe("deleteMemory", () => {
  test("deletes within the project and cleans up tags", async () => {
    const db = await twoProjects();
    const id = await seed(db, "p-a", "alpha memory");
    await db.execute({
      sql: "INSERT INTO memory_tags (memory_id, tag, created_at) VALUES (?, ?, ?)",
      args: [id, "infra", Date.now()],
    });

    expect(await deleteMemory(db, id, "p-a")).toBe(true);
    const mem = await db.execute({ sql: "SELECT id FROM memories WHERE id = ?", args: [id] });
    const tags = await db.execute({ sql: "SELECT tag FROM memory_tags WHERE memory_id = ?", args: [id] });
    expect(mem.rows.length).toBe(0);
    expect(tags.rows.length).toBe(0);
    db.close();
  });

  test("cannot delete across projects", async () => {
    const db = await twoProjects();
    const id = await seed(db, "p-b", "beta memory");
    expect(await deleteMemory(db, id, "p-a")).toBe(false);
    const still = await db.execute({ sql: "SELECT id FROM memories WHERE id = ?", args: [id] });
    expect(still.rows.length).toBe(1);
    db.close();
  });
});

describe("getMemoryWithRange", () => {
  test("returns the memory and its raw slice for the owning project", async () => {
    const db = await twoProjects();
    await upsertSession(db, { id: "s-a", project_id: "p-a" });
    const id = await seed(db, "p-a", "compressed alpha", {
      source_session_id: "s-a", source_start_msg_idx: 0, source_end_msg_idx: 2,
    });
    for (const idx of [0, 1]) {
      await insertRawMessage(db, {
        session_id: "s-a", msg_idx: idx, role: "user",
        content: `message ${idx}`, created_at: Date.now(),
      });
    }

    const got = await getMemoryWithRange(db, id, "p-a");
    expect(got?.rawMessages.length).toBe(2);
    db.close();
  });

  test("returns null for another project's memory — no raw transcript leak", async () => {
    const db = await twoProjects();
    await upsertSession(db, { id: "s-b", project_id: "p-b" });
    const id = await seed(db, "p-b", "compressed beta", {
      source_session_id: "s-b", source_start_msg_idx: 0, source_end_msg_idx: 1,
    });
    await insertRawMessage(db, {
      session_id: "s-b", msg_idx: 0, role: "user",
      content: "beta secret", created_at: Date.now(),
    });

    expect(await getMemoryWithRange(db, id, "p-a")).toBeNull();
    // Unscoped lookups still work — the CLI uses them deliberately.
    expect((await getMemoryWithRange(db, id))?.rawMessages.length).toBe(1);
    db.close();
  });
});
