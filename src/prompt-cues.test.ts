import { describe, expect, test } from "bun:test";
import { isPushback, contentTerms, extractCorrections } from "./prompt-cues.js";

describe("isPushback", () => {
  test.each([
    "no, use the other config",
    "that's wrong, the namespace is .apsolut-cortex",
    "don't touch the keyring code",
    "never commit without bumping the version",
    "not what I asked for",
    "I already told you we use libsql",
    "undo that change",
    "why did you delete the template?",
    "we don't use better-sqlite3 anymore",
  ])("detects pushback: %s", (prompt) => {
    expect(isPushback(prompt)).toBe(true);
  });

  test.each([
    "add a new migration for tags",
    "run the tests please",
    "what does the reflector do?",
    "notice how the buffer locks work",
    "the config file is in src",
    "",
    "ok",
  ])("ignores normal prompt: %s", (prompt) => {
    expect(isPushback(prompt)).toBe(false);
  });
});

describe("contentTerms", () => {
  test("extracts content words, drops stopwords", () => {
    const terms = contentTerms("no, don't use the keyring on linux");
    expect(terms).toContain("keyring");
    expect(terms).toContain("linux");
    expect(terms).not.toContain("the");
    expect(terms).not.toContain("don");
  });

  test("dedupes and caps at max", () => {
    const terms = contentTerms("alpha beta gamma delta epsilon zeta eta theta iota kappa alpha", 4);
    expect(terms.length).toBe(4);
    expect(new Set(terms).size).toBe(4);
  });

  test("empty prompt yields no terms", () => {
    expect(contentTerms("")).toEqual([]);
  });
});

describe("extractCorrections", () => {
  test("catches explicit self-corrections", () => {
    const found = extractCorrections(
      "Actually, the config lives in src/config.ts and not where I looked first."
    );
    expect(found.length).toBe(1);
    expect(found[0]).toContain("Self-correction:");
    expect(found[0]).toContain("config lives in src/config.ts");
  });

  test("catches an admitted mistake", () => {
    const found = extractCorrections(
      "My mistake. The migration runner records names in the _migrations table."
    );
    expect(found.length).toBe(1);
  });

  test("ignores benign prose that the old patterns matched", () => {
    // Both of these produced `correction` observations before 0.14.0 — the
    // highest-priority category, surfaced first at SessionStart.
    expect(extractCorrections("I will wait for the build to finish before running the tests.")).toEqual([]);
    expect(extractCorrections("It seems reasonable to cache the embedder between calls.")).toEqual([]);
    expect(extractCorrections("Turns out the tests take about two seconds to run in total.")).toEqual([]);
  });

  test("dedupes repeats and caps at five", () => {
    const text = Array.from({ length: 9 }, (_, i) =>
      `Actually, the correct file for step ${i} is src/step-${i}.ts in this repository.`
    ).join(" ");
    const found = extractCorrections(text);
    expect(found.length).toBeLessThanOrEqual(5);
    expect(new Set(found).size).toBe(found.length);
  });

  test("is repeatable — global regex state does not leak between calls", () => {
    const text = "Actually, the database path is ~/.apsolut-cortex/memory.db on every platform.";
    expect(extractCorrections(text)).toEqual(extractCorrections(text));
  });

  test("no matches in an empty transcript", () => {
    expect(extractCorrections("")).toEqual([]);
  });
});
