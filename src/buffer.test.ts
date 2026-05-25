/**
 * Tests for the per-session spill buffer + single-flight lock.
 * Uses random session ids so we never touch any real cortex state.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { existsSync } from "fs";
import {
  appendObservation,
  readBuffer,
  drainAndDelete,
  readCursor,
  writeCursor,
  clearCursor,
  tryAcquireLock,
  releaseLock,
  clearAllForSession,
  BUFFER_DIR,
} from "./buffer.js";

function newSessionId(label: string): string {
  return `${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const testSessions: string[] = [];

afterAll(() => {
  for (const sid of testSessions) {
    try { clearAllForSession(sid); drainAndDelete(sid); } catch {}
  }
});

describe("appendObservation / readBuffer / drainAndDelete", () => {
  test("round-trips a single observation", () => {
    const sid = newSessionId("buf");
    testSessions.push(sid);

    appendObservation(sid, {
      ts: 1, kind: "observer", start_msg_idx: 0, end_msg_idx: 5,
      tier: "semantic", category: "fact", content: "one", context: null,
    });
    const back = readBuffer(sid);
    expect(back.length).toBe(1);
    expect(back[0].content).toBe("one");
  });

  test("accumulates appended observations in order", () => {
    const sid = newSessionId("buf");
    testSessions.push(sid);

    for (let i = 0; i < 5; i++) {
      appendObservation(sid, {
        ts: i, kind: "observer", start_msg_idx: i, end_msg_idx: i + 1,
        tier: "episodic", category: "fact", content: `m${i}`, context: null,
      });
    }
    const back = readBuffer(sid);
    expect(back.map((o) => o.content)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
  });

  test("drainAndDelete returns then removes the file", () => {
    const sid = newSessionId("buf");
    testSessions.push(sid);

    appendObservation(sid, {
      ts: 1, kind: "observer", start_msg_idx: 0, end_msg_idx: 1,
      tier: "semantic", category: "fact", content: "drain-me", context: null,
    });
    const drained = drainAndDelete(sid);
    expect(drained.length).toBe(1);
    expect(readBuffer(sid)).toEqual([]);
  });

  test("readBuffer returns empty for missing session", () => {
    expect(readBuffer("never-existed-session")).toEqual([]);
  });
});

describe("cursor", () => {
  test("defaults to 0 when no cursor file", () => {
    expect(readCursor("never-cursored")).toBe(0);
  });

  test("round-trips a value", () => {
    const sid = newSessionId("cur");
    testSessions.push(sid);
    writeCursor(sid, 42);
    expect(readCursor(sid)).toBe(42);
    clearCursor(sid);
    expect(readCursor(sid)).toBe(0);
  });
});

describe("single-flight lock", () => {
  test("first acquire returns true, second returns false until released", () => {
    const sid = newSessionId("lock");
    testSessions.push(sid);

    expect(tryAcquireLock(sid)).toBe(true);
    expect(tryAcquireLock(sid)).toBe(false);
    releaseLock(sid);
    expect(tryAcquireLock(sid)).toBe(true);
    releaseLock(sid);
  });

  test("clearAllForSession removes both lock and cursor", () => {
    const sid = newSessionId("lock");
    testSessions.push(sid);

    tryAcquireLock(sid);
    writeCursor(sid, 7);
    clearAllForSession(sid);
    expect(tryAcquireLock(sid)).toBe(true);
    expect(readCursor(sid)).toBe(0);
    releaseLock(sid);
  });
});

describe("BUFFER_DIR", () => {
  test("is under the standard apsolut-cortex namespace", () => {
    expect(BUFFER_DIR).toContain(".apsolut-cortex");
    expect(BUFFER_DIR.toLowerCase()).toContain("buffer");
  });
});
