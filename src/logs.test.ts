/**
 * Tests for the JSONL retrieval/correction logs.
 *
 * The log paths are fixed to ~/.apsolut-cortex/logs/, so we monkey-patch
 * the environment for tests by writing into a tmp dir and re-importing
 * the module with a swapped LOGS_DIR. Simpler approach: test the actual
 * paths exist after a write, and clean up at end. We use a per-test
 * marker timestamp so we can find our own entries among real ones.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import {
  logRetrieval,
  logCorrection,
  getLastRetrieval,
  RETRIEVALS_PATH,
  CORRECTIONS_PATH,
  type RetrievalEntry,
} from "./logs.js";

// We write to the real paths because the module hard-codes them.
// Strategy: snapshot existing contents, append ours, restore on teardown.
let originalRetrievals: string | null = null;
let originalCorrections: string | null = null;

beforeAll(() => {
  if (existsSync(RETRIEVALS_PATH)) {
    originalRetrievals = readFileSync(RETRIEVALS_PATH, "utf-8");
  }
  if (existsSync(CORRECTIONS_PATH)) {
    originalCorrections = readFileSync(CORRECTIONS_PATH, "utf-8");
  }
});

afterAll(() => {
  // Restore original contents so we don't pollute the user's logs.
  if (originalRetrievals !== null) {
    writeFileSync(RETRIEVALS_PATH, originalRetrievals);
  } else if (existsSync(RETRIEVALS_PATH)) {
    unlinkSync(RETRIEVALS_PATH);
  }
  if (originalCorrections !== null) {
    writeFileSync(CORRECTIONS_PATH, originalCorrections);
  } else if (existsSync(CORRECTIONS_PATH)) {
    unlinkSync(CORRECTIONS_PATH);
  }
});

describe("logRetrieval / getLastRetrieval", () => {
  test("writes a retrieval and reads it back as the latest", () => {
    const marker = `test-${Date.now()}-${Math.random()}`;
    const entry: RetrievalEntry = {
      ts: Date.now(),
      project_id: "test-project",
      project_name: marker,
      query: "what is the test query",
      candidates: [
        {
          id: "mem-1",
          tier: "semantic",
          trust: "validated",
          weight: 1.2,
          bm25_rank: 1,
          vector_rank: 2,
          final_rank: 1,
        },
      ],
      injected_ids: ["mem-1"],
      latency_ms: 42,
      shadow: false,
    };
    logRetrieval(entry);

    const last = getLastRetrieval();
    expect(last).not.toBeNull();
    expect(last?.project_name).toBe(marker);
    expect(last?.candidates[0].bm25_rank).toBe(1);
    expect(last?.candidates[0].vector_rank).toBe(2);
  });

  test("routes shadow entries to shadow.jsonl, not retrievals.jsonl", () => {
    const marker = `shadow-test-${Date.now()}-${Math.random()}`;
    const lastBefore = getLastRetrieval();

    logRetrieval({
      ts: Date.now(),
      project_id: "test-project",
      project_name: marker,
      query: "shadow query",
      candidates: [],
      injected_ids: [],
      latency_ms: 1,
      shadow: true,
    });

    // The latest retrievals.jsonl entry should not be the shadow one
    const lastAfter = getLastRetrieval();
    expect(lastAfter?.project_name).not.toBe(marker);
    expect(lastAfter?.project_name).toBe(lastBefore?.project_name);
  });
});

describe("logCorrection", () => {
  test("appends a correction entry with the linked retrieval ts", () => {
    const retrievalTs = Date.now() - 1000;
    logCorrection({
      ts: Date.now(),
      retrieval_ts: retrievalTs,
      retrieval_query: "what is the test query",
      is_miss: true,
      correction_memory_id: "mem-correction-1",
      correction_text: "the right answer is X",
    });

    const text = readFileSync(CORRECTIONS_PATH, "utf-8");
    const lines = text.split(/\r?\n/).filter((l) => l.trim());
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.retrieval_ts).toBe(retrievalTs);
    expect(last.correction_memory_id).toBe("mem-correction-1");
  });
});

describe("getLastRetrieval — empty case", () => {
  test("returns null when retrievals.jsonl does not exist", () => {
    // Take a snapshot, delete, check, restore.
    const snapshot = existsSync(RETRIEVALS_PATH)
      ? readFileSync(RETRIEVALS_PATH, "utf-8")
      : null;
    if (existsSync(RETRIEVALS_PATH)) unlinkSync(RETRIEVALS_PATH);

    expect(getLastRetrieval()).toBeNull();

    if (snapshot !== null) {
      const dir = dirname(RETRIEVALS_PATH);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(RETRIEVALS_PATH, snapshot);
    }
  });
});
