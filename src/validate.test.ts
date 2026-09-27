/**
 * Tests for the value-domain guards. The table has no CHECK constraints, so
 * these functions are the only thing standing between LLM output and rows the
 * tier/category filters can never match again.
 */

import { describe, test, expect } from "bun:test";
import {
  isTier, isCategory, isTrust,
  coerceTier, coerceCategory,
  clampText, validateMemoryInput,
  CONTENT_MAX,
} from "./validate.js";

describe("domain guards", () => {
  test("accept every documented value", () => {
    for (const t of ["episodic", "semantic", "procedural", "strategic", "meta"]) {
      expect(isTier(t)).toBe(true);
    }
    for (const c of ["correction", "insight", "decision", "discovery", "fact", "pattern"]) {
      expect(isCategory(c)).toBe(true);
    }
    for (const t of ["observed", "validated", "proven", "canonical"]) {
      expect(isTrust(t)).toBe(true);
    }
  });

  test("reject invented values, wrong types and casing", () => {
    expect(isTier("banana")).toBe(false);
    expect(isCategory("junk")).toBe(false);
    expect(isTrust("yolo")).toBe(false);
    expect(isTier("Semantic")).toBe(false);
    expect(isCategory(42)).toBe(false);
    expect(isTrust(null)).toBe(false);
    expect(isTier(undefined)).toBe(false);
  });
});

describe("coercion (LLM-output path)", () => {
  test("keeps valid values and defaults invalid ones", () => {
    expect(coerceTier("procedural")).toBe("procedural");
    expect(coerceTier("important")).toBe("semantic");
    expect(coerceCategory("decision")).toBe("decision");
    expect(coerceCategory("")).toBe("insight");
    expect(coerceTier(undefined)).toBe("semantic");
  });
});

describe("clampText", () => {
  test("returns null for empty or whitespace-only text", () => {
    expect(clampText("", 100)).toBeNull();
    expect(clampText("   \n\t ", 100)).toBeNull();
  });

  test("passes short text through trimmed", () => {
    expect(clampText("  hello  ", 100)).toBe("hello");
  });

  test("truncates and marks long text", () => {
    const out = clampText("word ".repeat(2000), 100)!;
    expect(out.length).toBeLessThanOrEqual(120);
    expect(out).toContain("[…truncated]");
  });

  test("does not truncate at exactly the limit", () => {
    const exact = "x".repeat(50);
    expect(clampText(exact, 50)).toBe(exact);
  });
});

describe("validateMemoryInput (MCP boundary)", () => {
  test("returns normalized values for valid input", () => {
    const v = validateMemoryInput({
      content: "  the build uses bun  ",
      category: "fact",
      tier: "semantic",
      context: "  while reading package.json  ",
    });
    expect(v).toEqual({
      tier: "semantic",
      category: "fact",
      content: "the build uses bun",
      context: "while reading package.json",
    });
  });

  test("names the offending field so the model can fix its call", () => {
    expect(() =>
      validateMemoryInput({ content: "x".repeat(30), category: "junk", tier: "semantic", context: null })
    ).toThrow(/invalid category "junk"/);
    expect(() =>
      validateMemoryInput({ content: "x".repeat(30), category: "fact", tier: "banana", context: null })
    ).toThrow(/invalid tier "banana"/);
  });

  test("rejects empty content", () => {
    expect(() =>
      validateMemoryInput({ content: "   ", category: "fact", tier: "semantic", context: null })
    ).toThrow(/content is required/);
  });

  test("caps content at CONTENT_MAX", () => {
    const v = validateMemoryInput({
      content: "a".repeat(CONTENT_MAX * 2),
      category: "fact",
      tier: "semantic",
      context: null,
    });
    expect(v.content.length).toBeLessThan(CONTENT_MAX + 20);
  });
});
