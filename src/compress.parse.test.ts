/**
 * The compression output boundary: whatever Haiku or a local Ollama model
 * returns has to come out of here as valid rows or not at all.
 */

import { describe, test, expect } from "bun:test";
import { parseResult } from "./compress.js";
import { CONTENT_MAX } from "./validate.js";

describe("parseResult", () => {
  test("parses a well-formed response", () => {
    const out = parseResult(JSON.stringify({
      memories: [{ tier: "strategic", category: "decision", content: "we chose libSQL over better-sqlite3", context: "phase 1" }],
      summary: "Picked a database.",
    }));
    expect(out.summary).toBe("Picked a database.");
    expect(out.memories).toEqual([{
      tier: "strategic", category: "decision",
      content: "we chose libSQL over better-sqlite3", context: "phase 1",
    }]);
  });

  test("strips markdown fences and surrounding prose", () => {
    const out = parseResult(
      'Sure! Here is the JSON:\n```json\n{"memories":[],"summary":"Nothing notable."}\n```\nHope that helps.'
    );
    expect(out.summary).toBe("Nothing notable.");
  });

  test("coerces invented tiers and categories instead of storing them", () => {
    const out = parseResult(JSON.stringify({
      memories: [{ tier: "banana", category: "junk", content: "the CLI entry point is dist/cli.js" }],
      summary: "",
    }));
    expect(out.memories[0].tier).toBe("semantic");
    expect(out.memories[0].category).toBe("insight");
  });

  test("drops entries with no usable content", () => {
    const out = parseResult(JSON.stringify({
      memories: [
        { tier: "semantic", category: "fact" },
        { tier: "semantic", category: "fact", content: "   " },
        { tier: "semantic", category: "fact", content: 42 },
        "not an object",
        null,
        { tier: "semantic", category: "fact", content: "this one is real" },
      ],
      summary: "",
    }));
    expect(out.memories.length).toBe(1);
    expect(out.memories[0].content).toBe("this one is real");
  });

  test("clamps oversized content and summary", () => {
    const out = parseResult(JSON.stringify({
      memories: [{ tier: "semantic", category: "fact", content: "x".repeat(CONTENT_MAX * 3) }],
      summary: "y".repeat(10_000),
    }));
    expect(out.memories[0].content.length).toBeLessThan(CONTENT_MAX + 20);
    expect(out.summary.length).toBe(2000);
  });

  test("tolerates a non-array memories field", () => {
    expect(parseResult('{"memories":"none","summary":"ok"}').memories).toEqual([]);
  });

  test("throws when there is no JSON at all", () => {
    expect(() => parseResult("I cannot help with that.")).toThrow(/not JSON/);
  });
});
