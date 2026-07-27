import { describe, expect, test } from "bun:test";
import { isPushback, contentTerms } from "./prompt-cues.js";

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
