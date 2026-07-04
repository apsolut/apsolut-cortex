/**
 * Tests for compressSlice provider-failure handling.
 * Uses an isolated in-memory libSQL db + random session ids so no real
 * cortex state is touched. The global breaker file is saved and restored
 * around the suite so the circuit breaker is deterministically closed.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir, homedir } from "os";
import { runMigrations } from "./migrations/runner.js";
import { upsertProject } from "./db.js";
import { compressSlice } from "./compress-runner.js";
import { compressSession } from "./compress.js";
import { readCursor, clearAllForSession } from "./buffer.js";

const BREAKER_PATH = join(homedir(), ".apsolut-cortex", "compression-state.json");

function newSessionId(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  return db;
}

const savedAnthropicKey = process.env.ANTHROPIC_API_KEY;
const savedOllamaHost = process.env.OLLAMA_HOST;
const savedBreaker = existsSync(BREAKER_PATH) ? readFileSync(BREAKER_PATH, "utf-8") : null;
const testSessions: string[] = [];
let tmpDir = "";

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  process.env.OLLAMA_HOST = "http://127.0.0.1:1";
  try { unlinkSync(BREAKER_PATH); } catch {}
  tmpDir = mkdtempSync(join(tmpdir(), "cortex-compress-runner-"));
});

afterAll(() => {
  if (savedAnthropicKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = savedAnthropicKey;
  if (savedOllamaHost === undefined) delete process.env.OLLAMA_HOST;
  else process.env.OLLAMA_HOST = savedOllamaHost;
  if (savedBreaker === null) {
    try { unlinkSync(BREAKER_PATH); } catch {}
  } else {
    try { writeFileSync(BREAKER_PATH, savedBreaker); } catch {}
  }
  for (const sid of testSessions) {
    try { clearAllForSession(sid); } catch {}
  }
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch {}
});

describe("compressSlice provider failure", () => {
  test("keeps cursor, stores no memories, still persists raw messages", async () => {
    const sid = newSessionId("fail");
    testSessions.push(sid);

    const transcriptPath = join(tmpDir, `${sid}.jsonl`);
    const lines = [
      { type: "user", message: { role: "user", content: "please fix the login bug" } },
      { type: "assistant", message: { role: "assistant", content: "reading auth.ts now" } },
      { type: "user", message: { role: "user", content: "actually it is in session.ts" } },
      { type: "assistant", message: { role: "assistant", content: "fixed the session bug" } },
      { type: "user", message: { role: "user", content: "great, thanks" } },
    ];
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

    const db = await freshDb();
    await upsertProject(db, { id: "p-fail", name: "test-project" });

    const result = await compressSlice({
      db,
      sessionId: sid,
      projectId: "p-fail",
      projectName: "test-project",
      transcriptPath,
      source: "session-end",
    });

    expect(result.failed).toBe(true);
    expect(result.memories_stored).toBe(0);
    expect(result.raw_persisted).toBe(5);
    expect(result.new_cursor).toBe(0);
    expect(readCursor(sid)).toBe(0);

    const raw = await db.execute({
      sql: "SELECT COUNT(*) as n FROM raw_messages WHERE session_id = ?",
      args: [sid],
    });
    expect(raw.rows[0]?.n).toBe(5);

    const mems = await db.execute("SELECT COUNT(*) as n FROM memories");
    expect(mems.rows[0]?.n).toBe(0);

    db.close();
  });
});

describe("compressSession with zero observations", () => {
  test("returns the empty non-null result", async () => {
    const result = await compressSession([], "test-project");
    expect(result).not.toBeNull();
    expect(result?.memories).toEqual([]);
    expect(result?.summary).toBe("");
  });
});
