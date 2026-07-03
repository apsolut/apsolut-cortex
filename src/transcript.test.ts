/**
 * Tests for transcript parsing + raw_messages persistence (M6 → M4 bridge).
 */

import { describe, test, expect, afterAll } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { runMigrations } from "./migrations/runner.js";
import { upsertProject, upsertSession } from "./db.js";
import { readTranscript, sliceRange, persistRawMessages, captureTranscript } from "./transcript.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "apsolut-cortex-transcript-test-"));

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  await upsertProject(db, { id: "p-1", name: "test" });
  await upsertSession(db, { id: "s-1", project_id: "p-1" });
  return db;
}

function writeTranscript(name: string, lines: object[]): string {
  const path = join(tmpRoot, `${name}.jsonl`);
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

describe("readTranscript", () => {
  test("returns empty array for a missing file", () => {
    expect(readTranscript(join(tmpRoot, "nope.jsonl"))).toEqual([]);
  });

  test("parses simple string-content messages with sequential msg_idx", () => {
    const path = writeTranscript("simple", [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello back" },
      { role: "user", content: "another" },
    ]);
    const t = readTranscript(path);
    expect(t.length).toBe(3);
    expect(t[0].msg_idx).toBe(0);
    expect(t[1].msg_idx).toBe(1);
    expect(t[2].msg_idx).toBe(2);
    expect(t[1].role).toBe("assistant");
    expect(t[2].content).toBe("another");
  });

  test("flattens structured-block content", () => {
    const path = writeTranscript("blocks", [
      { role: "assistant", content: [
        { type: "text", text: "let me run that" },
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
      ] },
    ]);
    const t = readTranscript(path);
    expect(t.length).toBe(1);
    expect(t[0].content).toContain("let me run that");
    expect(t[0].content).toContain("[tool_use Bash:");
  });

  test("parses real Claude Code envelope lines (type + message wrapper)", () => {
    const path = writeTranscript("envelope", [
      { type: "last-prompt", leafUuid: "x", sessionId: "s" },
      { type: "user", message: { role: "user", content: "user says hi" }, sessionId: "s" },
      {
        type: "assistant",
        message: { role: "assistant", content: [{ type: "text", text: "assistant replies" }] },
        sessionId: "s",
      },
    ]);
    const t = readTranscript(path);
    expect(t.length).toBe(3);
    // Non-message lines fall back to their top-level `type` as the role.
    expect(t[0].role).toBe("last-prompt");
    expect(t[1].role).toBe("user");
    expect(t[1].content).toBe("user says hi");
    expect(t[2].role).toBe("assistant");
    expect(t[2].content).toContain("assistant replies");
  });

  test("skips malformed lines but keeps index alignment", () => {
    const path = join(tmpRoot, "malformed.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ role: "user", content: "a" }),
        "garbage",
        JSON.stringify({ role: "user", content: "c" }),
      ].join("\n")
    );
    const t = readTranscript(path);
    expect(t.length).toBe(2);
    // Indexes are sequential across only the *valid* lines we keep.
    expect(t[0].msg_idx).toBe(0);
    // The skipped malformed line bumps the counter, so 'c' is at index 2.
    expect(t[1].msg_idx).toBe(2);
  });
});

describe("sliceRange", () => {
  test("returns inclusive-start, exclusive-end slice by msg_idx", () => {
    const path = writeTranscript("range", [
      { role: "user", content: "0" },
      { role: "user", content: "1" },
      { role: "user", content: "2" },
      { role: "user", content: "3" },
    ]);
    const t = readTranscript(path);
    const s = sliceRange(t, 1, 3);
    expect(s.map((m) => m.content)).toEqual(["1", "2"]);
  });
});

describe("persistRawMessages + captureTranscript", () => {
  test("persists messages with idempotent INSERT OR IGNORE", async () => {
    const db = await freshDb();
    const path = writeTranscript("persist", [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" },
    ]);

    const t = readTranscript(path);
    const n = await persistRawMessages(db, "s-1", t);
    expect(n).toBe(2);

    // Re-run — same rows should NOT duplicate (INSERT OR IGNORE on composite PK).
    await persistRawMessages(db, "s-1", t);
    const count = await db.execute("SELECT COUNT(*) AS n FROM raw_messages WHERE session_id='s-1'");
    expect(count.rows[0]?.n).toBe(2);

    db.close();
  });

  test("captureTranscript returns the parsed transcript after persisting", async () => {
    const db = await freshDb();
    const path = writeTranscript("capture", [
      { role: "user", content: "u1" },
      { role: "assistant", content: "a1" },
    ]);

    const t = await captureTranscript(db, "s-1", path);
    expect(t.length).toBe(2);
    const rows = await db.execute("SELECT content FROM raw_messages WHERE session_id='s-1' ORDER BY msg_idx");
    expect(rows.rows.map((r) => r.content as string)).toEqual(["u1", "a1"]);

    db.close();
  });
});
