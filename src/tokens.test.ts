/**
 * Tests for the token estimator + transcript flattening.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { countTokens, countTranscriptTokens, flattenMessageContent } from "./tokens.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "apsolut-cortex-tokens-test-"));

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

describe("countTokens", () => {
  test("returns 0 for empty string", () => {
    expect(countTokens("")).toBe(0);
  });

  test("counts more tokens for longer text", () => {
    const short = countTokens("hello");
    const long = countTokens("hello ".repeat(100));
    expect(long).toBeGreaterThan(short);
  });
});

describe("flattenMessageContent", () => {
  test("returns content as-is when it is a string", () => {
    expect(flattenMessageContent({ role: "user", content: "hi" })).toBe("hi");
  });

  test("extracts text blocks from a structured message", () => {
    const msg = {
      role: "assistant",
      content: [
        { type: "text", text: "Let me check that." },
        { type: "tool_use", name: "Bash", input: { command: "ls" } },
      ],
    };
    const flat = flattenMessageContent(msg);
    expect(flat).toContain("Let me check that.");
    expect(flat).toContain("[tool_use Bash:");
  });

  test("extracts text from tool_result blocks (both string and array forms)", () => {
    const strForm = flattenMessageContent({
      role: "user",
      content: [{ type: "tool_result", content: "file1\nfile2" }],
    });
    expect(strForm).toContain("file1");

    const arrForm = flattenMessageContent({
      role: "user",
      content: [{ type: "tool_result", content: [{ type: "text", text: "result text" }] }],
    });
    expect(arrForm).toContain("result text");
  });

  test("returns empty string for null/undefined/garbage", () => {
    expect(flattenMessageContent(null)).toBe("");
    expect(flattenMessageContent(undefined)).toBe("");
    expect(flattenMessageContent("not an object")).toBe("");
  });
});

describe("countTranscriptTokens", () => {
  test("returns 0 for a missing file", () => {
    expect(countTranscriptTokens(join(tmpRoot, "does-not-exist.jsonl"))).toBe(0);
  });

  test("tokenizes a JSON-l transcript", () => {
    const path = join(tmpRoot, "transcript.jsonl");
    const lines = [
      JSON.stringify({ role: "user", content: "what is the answer" }),
      JSON.stringify({ role: "assistant", content: [{ type: "text", text: "the answer is 42" }] }),
    ];
    writeFileSync(path, lines.join("\n"));
    const n = countTranscriptTokens(path);
    expect(n).toBeGreaterThan(0);
    expect(n).toBeGreaterThan(countTokens("the answer is 42"));
  });

  test("skips malformed lines instead of throwing", () => {
    const path = join(tmpRoot, "malformed.jsonl");
    writeFileSync(
      path,
      [
        JSON.stringify({ role: "user", content: "good line" }),
        "{not valid json",
        JSON.stringify({ role: "assistant", content: "another good line" }),
      ].join("\n")
    );
    const n = countTranscriptTokens(path);
    expect(n).toBeGreaterThan(0);
  });
});
