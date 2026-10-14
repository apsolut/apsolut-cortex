/**
 * `<private>` is the user's only lever for keeping something out of memory
 * entirely, so its edge cases matter more than its happy path.
 */

import { describe, test, expect } from "bun:test";
import { stripPrivate } from "./privacy.js";

describe("stripPrivate", () => {
  test("removes a private block and keeps the rest", () => {
    expect(stripPrivate("before <private>secret</private> after")).toBe("before  after");
  });

  test("removes several blocks", () => {
    expect(stripPrivate("a <private>x</private> b <private>y</private> c")).toBe("a  b  c");
  });

  test("is case-insensitive on the tags", () => {
    expect(stripPrivate("a <PRIVATE>x</PRIVATE> b")).toBe("a  b");
  });

  test("returns null when everything was private", () => {
    expect(stripPrivate("<private>all of it</private>")).toBeNull();
    expect(stripPrivate("   <private>all of it</private>  ")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(stripPrivate("")).toBeNull();
    expect(stripPrivate("   ")).toBeNull();
  });

  test("drops the tail of an unterminated block", () => {
    // Nothing marks where the secret ends, so the only safe reading is that
    // everything after the tag is secret. Keeping it failed open on the one
    // construct whose whole purpose is to withhold something.
    expect(stripPrivate("keep this <private>unterminated")).toBe("keep this");
  });

  test("an unterminated block that opens the message yields null", () => {
    expect(stripPrivate("<private>sk-ant-secret-with-no-closing-tag")).toBeNull();
  });

  test("passes ordinary text through trimmed", () => {
    expect(stripPrivate("  nothing private here  ")).toBe("nothing private here");
  });

  test("handles multi-line blocks", () => {
    expect(stripPrivate("head\n<private>\nkey=abc\n</private>\ntail")).toBe("head\n\ntail");
  });
});
