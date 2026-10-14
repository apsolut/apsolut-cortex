/**
 * Regressions for the 0.14.1 hardening pass.
 *
 * Each test here corresponds to a defect that shipped and was not caught by
 * anything: an observation backlog silently written off, raw source deleted
 * out from under memories the user had promoted, a circuit breaker that
 * treated "nothing configured" as provider flakiness, a backup assembled
 * from two different instants, and a project id that authorized access to
 * any directory's memories.
 */

import { describe, test, expect, afterEach } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { existsSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { runMigrations } from "./migrations/runner.js";
import {
  insertObservation,
  getSessionObservations,
  getUnprocessedObservations,
  markObservationsPromotedByIds,
  countUnprocessedObservations,
  insertRawMessage,
  insertMemory,
  purgeRawMessages,
  getRawRange,
  upsertProject,
  upsertSession,
} from "./db.js";
import { snapshotFrom } from "./backup.js";
import { providerConfigured } from "./compress.js";
import { checkProjectBinding, type Registry } from "./registry.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!;
    try { rmSync(d, { recursive: true, force: true }); } catch {}
  }
});

async function freshDb(): Promise<{ db: Client; dir: string; path: string }> {
  const dir = mkdtempSync(join(tmpdir(), "cortex-harden-"));
  dirs.push(dir);
  const path = join(dir, "memory.db");
  const db = createClient({ url: `file:${path}` });
  await runMigrations(db);
  await upsertProject(db, { id: "p-1", name: "proj", path: dir });
  await upsertSession(db, { id: "s-1", project_id: "p-1" });
  return { db, dir, path };
}

describe("observation backlog", () => {
  test("promotes only the observations that were actually compressed", async () => {
    // The shipped behaviour: recovery loaded 50 stale observations, then a
    // successful compression ran `UPDATE observations SET promoted = 1 WHERE
    // project_id = ? AND promoted = 0` — flagging the entire backlog,
    // including everything the compressor never saw. A project sitting on 174
    // of them lost ~124, unseen, the first time compression succeeded.
    const { db } = await freshDb();
    await upsertSession(db, { id: "s-old", project_id: "p-1" });

    for (let i = 0; i < 120; i++) {
      await insertObservation(db, {
        session_id: "s-old",
        project_id: "p-1",
        content: `stale observation ${i}`,
        category: "failure",
      });
    }
    expect(await countUnprocessedObservations(db, "p-1")).toBe(120);

    const current = await getSessionObservations(db, "s-1");
    const stale = await getUnprocessedObservations(db, "p-1", "s-1");
    expect(stale.length).toBe(50); // batch ceiling

    const handed = [...current, ...stale].map((o) => o.id);
    const promoted = await markObservationsPromotedByIds(db, handed);
    expect(promoted).toBe(50);

    // The other 70 survive for the next session instead of being written off.
    expect(await countUnprocessedObservations(db, "p-1")).toBe(70);

    db.close();
  });

  test("an observation inserted after the batch was taken is not promoted", async () => {
    const { db } = await freshDb();
    await insertObservation(db, {
      session_id: "s-1", project_id: "p-1", content: "first", category: "failure",
    });

    const batch = await getSessionObservations(db, "s-1");
    expect(batch.length).toBe(1);

    // Concurrent hook writes while compression is in flight.
    await insertObservation(db, {
      session_id: "s-1", project_id: "p-1", content: "arrived later", category: "failure",
    });

    await markObservationsPromotedByIds(db, batch.map((o) => o.id));

    const left = await getSessionObservations(db, "s-1");
    expect(left.map((o) => o.content)).toEqual(["arrived later"]);

    db.close();
  });

  test("promoting an empty list touches nothing", async () => {
    const { db } = await freshDb();
    expect(await markObservationsPromotedByIds(db, [])).toBe(0);
    db.close();
  });

  test("promotes a backlog larger than SQLite's parameter ceiling", async () => {
    const { db } = await freshDb();
    const ids: string[] = [];
    for (let i = 0; i < 1100; i++) {
      ids.push(
        await insertObservation(db, {
          session_id: "s-1", project_id: "p-1", content: `obs ${i}`, category: "failure",
        })
      );
    }
    expect(await markObservationsPromotedByIds(db, ids)).toBe(1100);
    expect(await countUnprocessedObservations(db, "p-1")).toBe(0);
    db.close();
  });
});

describe("raw-message retention", () => {
  async function seedRange(db: Client, trust: "observed" | "proven") {
    const ancient = Date.now() - 365 * 24 * 60 * 60 * 1000;
    for (let i = 0; i < 3; i++) {
      await insertRawMessage(db, {
        session_id: "s-1", msg_idx: i, role: "user",
        content: `verbatim ${i}`, created_at: ancient,
      });
    }
    await insertMemory(db, {
      project_id: "p-1", tier: "semantic", category: "fact", trust,
      content: "derived from that window", context: null, source: "test",
      embedding: null, weight: 1, session_id: "s-1",
      source_session_id: "s-1", source_start_msg_idx: 0, source_end_msg_idx: 3,
    });
  }

  test("keeps source ranges behind a promoted memory", async () => {
    // `proven` and `canonical` memories are exempt from decay and pruning, but
    // their raw source was deleted at 90 days anyway — so memory_recall on a
    // memory the user had explicitly vouched for degraded to "window was
    // pruned" while the memory itself was protected.
    const { db } = await freshDb();
    await seedRange(db, "proven");

    const purged = await purgeRawMessages(db, 90);
    expect(purged).toBe(0);

    const range = await getRawRange(db, "s-1", 0, 3);
    expect(range.length).toBe(3);

    db.close();
  });

  test("still ages out everything else", async () => {
    const { db } = await freshDb();
    await seedRange(db, "observed");

    const purged = await purgeRawMessages(db, 90);
    expect(purged).toBe(3);
    expect((await getRawRange(db, "s-1", 0, 3)).length).toBe(0);

    db.close();
  });

  test("a zero or negative window is a no-op, not a wipe", async () => {
    const { db } = await freshDb();
    await seedRange(db, "observed");
    expect(await purgeRawMessages(db, 0)).toBe(0);
    expect(await purgeRawMessages(db, -1)).toBe(0);
    expect((await getRawRange(db, "s-1", 0, 3)).length).toBe(3);
    db.close();
  });
});

describe("consistent snapshot", () => {
  test("writes a single self-contained file with no WAL sidecar", async () => {
    // The old path copied memory.db and then best-effort copied memory.db-wal:
    // two files read at two instants while hooks, workers and the MCP server
    // all write. A failed WAL copy was swallowed and still reported success.
    const { db, dir, path } = await freshDb();
    await insertObservation(db, {
      session_id: "s-1", project_id: "p-1", content: "committed before snapshot", category: "failure",
    });

    const dest = join(dir, "snap.db");
    const out = await snapshotFrom(db, path, dest);
    expect(out).toBe(dest);
    expect(existsSync(dest)).toBe(true);
    // VACUUM INTO checkpoints into the target — nothing left in a sidecar.
    expect(existsSync(`${dest}-wal`)).toBe(false);

    // The snapshot opens cleanly and carries the committed row.
    const restored = createClient({ url: `file:${dest}` });
    const rows = await restored.execute("SELECT content FROM observations");
    expect(rows.rows.map((r) => r.content as string)).toEqual(["committed before snapshot"]);
    restored.close();

    db.close();
  });
});

describe("compression breaker", () => {
  const KEYS = ["ANTHROPIC_API_KEY", "OLLAMA_HOST", "APSOLUT_CORTEX_OLLAMA_MODEL"];

  function withEnv(set: Record<string, string | undefined>, fn: () => void) {
    const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    try {
      for (const k of KEYS) delete process.env[k];
      for (const [k, v] of Object.entries(set)) if (v !== undefined) process.env[k] = v;
      fn();
    } finally {
      for (const k of KEYS) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k]!;
      }
    }
  }

  test("no provider configured is a settings problem, not a breaker failure", () => {
    // Counting it opened a one-hour circuit on a fresh install, so the user
    // who read the banner and set ANTHROPIC_API_KEY was still locked out.
    withEnv({}, () => expect(providerConfigured()).toBe(false));
  });

  test("any configured provider counts as configured", () => {
    withEnv({ ANTHROPIC_API_KEY: "sk-test" }, () => expect(providerConfigured()).toBe(true));
    withEnv({ OLLAMA_HOST: "http://localhost:11434" }, () => expect(providerConfigured()).toBe(true));
    withEnv({ APSOLUT_CORTEX_OLLAMA_MODEL: "llama3" }, () => expect(providerConfigured()).toBe(true));
  });
});

describe("project binding", () => {
  const registry = (path: string): Registry => ({
    projects: { "11111111-2222-3333-4444-555555555555": { name: "original", path, registered_at: 1 } },
  });
  const ID = "11111111-2222-3333-4444-555555555555";

  test("refuses an id registered to a different directory", () => {
    // Copy a repo and its .apsolut-cortex/project.json claims the original's
    // memories: search them, recall their transcripts, delete them.
    const refusal = checkProjectBinding(ID, "D:/sites/copy-of-project", registry("D:/sites/original"));
    expect(refusal).toBeTruthy();
    expect(refusal).toContain("D:/sites/original");
    expect(refusal).toContain("apsolut-cortex init");
  });

  test("accepts the directory that owns the id", () => {
    expect(checkProjectBinding(ID, "D:/sites/original", registry("D:/sites/original"))).toBeNull();
  });

  test("ignores separator and trailing-slash differences", () => {
    expect(checkProjectBinding(ID, "D:\\sites\\original\\", registry("D:/sites/original"))).toBeNull();
  });

  test("an unregistered id is allowed — that is a new project", () => {
    expect(checkProjectBinding("unknown-id", "D:/anywhere", registry("D:/sites/original"))).toBeNull();
  });
});
