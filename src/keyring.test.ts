/**
 * Tests for the OS-keychain wrapper. Uses a unique per-test service name
 * so we never pollute the user's real `apsolut-cortex` keychain entry,
 * and cleans up in afterAll.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  getDbKey,
  setDbKey,
  deleteDbKey,
  generateDbKey,
} from "./keyring.js";

const TEST_SERVICE = `apsolut-cortex-test-${process.pid}-${Date.now()}`;
const TEST_ACCOUNT = "test-key";

beforeAll(() => {
  // Belt + suspenders: clean any leftover entry from a crashed run.
  try { deleteDbKey(TEST_SERVICE, TEST_ACCOUNT); } catch {}
});

afterAll(() => {
  try { deleteDbKey(TEST_SERVICE, TEST_ACCOUNT); } catch {}
});

describe("generateDbKey", () => {
  test("returns a 64-character hex string", () => {
    const k = generateDbKey();
    expect(k).toMatch(/^[0-9a-f]{64}$/);
  });

  test("returns a different value each time (entropy check)", () => {
    const a = generateDbKey();
    const b = generateDbKey();
    expect(a).not.toBe(b);
  });
});

describe("keychain round-trip", () => {
  test("getDbKey returns null when no entry exists", () => {
    const got = getDbKey(TEST_SERVICE, TEST_ACCOUNT);
    expect(got).toBeNull();
  });

  test("setDbKey + getDbKey round-trips the value", () => {
    const key = generateDbKey();
    setDbKey(key, TEST_SERVICE, TEST_ACCOUNT);
    const got = getDbKey(TEST_SERVICE, TEST_ACCOUNT);
    expect(got).toBe(key);
  });

  test("deleteDbKey removes the entry", () => {
    setDbKey("temp", TEST_SERVICE, TEST_ACCOUNT);
    expect(getDbKey(TEST_SERVICE, TEST_ACCOUNT)).toBe("temp");
    deleteDbKey(TEST_SERVICE, TEST_ACCOUNT);
    expect(getDbKey(TEST_SERVICE, TEST_ACCOUNT)).toBeNull();
  });
});
