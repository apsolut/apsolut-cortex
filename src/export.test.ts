/**
 * Tests for the Obsidian markdown export. Targets an isolated tmp vault
 * dir so the user's real ~/.apsolut-cortex/obsidian/ is never touched.
 */

import { describe, test, expect, afterAll } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createClient, type Client } from "@libsql/client";
import { runMigrations } from "./migrations/runner.js";
import { upsertProject, insertMemory } from "./db.js";
import { exportVault } from "./export.js";

const tmpRoot = mkdtempSync(join(tmpdir(), "apsolut-cortex-export-test-"));

afterAll(() => {
  try { rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
});

async function freshDb(): Promise<Client> {
  const db = createClient({ url: ":memory:" });
  await runMigrations(db);
  return db;
}

describe("exportVault", () => {
  test("writes one .md per memory plus index.md", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "test-project" });

    for (let i = 0; i < 3; i++) {
      await insertMemory(db, {
        project_id: "p-1",
        tier: "semantic",
        category: "fact",
        trust: "validated",
        content: `memory number ${i} about something interesting`,
        context: null,
        source: "manual",
        embedding: null,
        weight: 1.0 + i * 0.1,
        session_id: null,
      });
    }

    const vault = join(tmpRoot, "vault-1");
    const result = await exportVault(db, { vaultDir: vault });

    expect(result.memories_written).toBe(3);
    expect(existsSync(join(vault, "index.md"))).toBe(true);

    const memFiles = readdirSync(join(vault, "memories")).filter((f) => f.endsWith(".md"));
    expect(memFiles.length).toBe(3);

    const index = readFileSync(join(vault, "index.md"), "utf-8");
    expect(index).toContain("test-project");
    expect(index).toContain("3 memories across 1 project(s)");

    db.close();
  });

  test("memory file has YAML frontmatter and the content body", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "fmtest" });

    await insertMemory(db, {
      project_id: "p-1",
      tier: "strategic",
      category: "decision",
      trust: "proven",
      content: "We use libSQL for everything",
      context: "Decided after looking at sqlite-vec, SQLCipher options",
      source: "manual",
      embedding: null,
      weight: 1.5,
      session_id: null,
    });

    const vault = join(tmpRoot, "vault-2");
    await exportVault(db, { vaultDir: vault });

    const files = readdirSync(join(vault, "memories"));
    expect(files.length).toBe(1);
    const body = readFileSync(join(vault, "memories", files[0]), "utf-8");

    expect(body).toMatch(/^---\n/);
    expect(body).toMatch(/^id: "/m);
    expect(body).toContain('project: "fmtest"');
    expect(body).toContain('tier: "strategic"');
    expect(body).toContain('category: "decision"');
    expect(body).toContain('trust: "proven"');
    expect(body).toContain("We use libSQL for everything");
    expect(body).toContain("## Context");
    expect(body).toContain("Decided after looking at");

    db.close();
  });

  test("removes orphaned .md files on full re-export", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "gc-test" });

    const id1 = await insertMemory(db, {
      project_id: "p-1", tier: "semantic", category: "fact", trust: "observed",
      content: "first", context: null, source: "manual", embedding: null,
      weight: 1.0, session_id: null,
    });
    await insertMemory(db, {
      project_id: "p-1", tier: "semantic", category: "fact", trust: "observed",
      content: "second", context: null, source: "manual", embedding: null,
      weight: 1.0, session_id: null,
    });

    const vault = join(tmpRoot, "vault-3");
    await exportVault(db, { vaultDir: vault });
    expect(readdirSync(join(vault, "memories")).length).toBe(2);

    // Delete one memory from DB; re-export should garbage-collect its file
    await db.execute({ sql: "DELETE FROM memories WHERE id = ?", args: [id1] });
    const result = await exportVault(db, { vaultDir: vault });

    expect(result.memories_written).toBe(1);
    expect(result.files_removed).toBe(1);
    expect(readdirSync(join(vault, "memories")).length).toBe(1);

    db.close();
  });

  test("full export generates compiled views (by-category, by-project, _health)", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "compiled-project" });

    await insertMemory(db, {
      project_id: "p-1", tier: "semantic", category: "decision", trust: "validated",
      content: "first decision", context: null, source: "manual", embedding: null,
      weight: 1.5, session_id: null,
    });
    await insertMemory(db, {
      project_id: "p-1", tier: "episodic", category: "correction", trust: "observed",
      content: "an old correction", context: null, source: "manual", embedding: null,
      weight: 1.0, session_id: null,
    });

    const vault = join(tmpRoot, "vault-compiled");
    await exportVault(db, { vaultDir: vault });

    expect(existsSync(join(vault, "_health.md"))).toBe(true);
    expect(existsSync(join(vault, "by-category", "decision.md"))).toBe(true);
    expect(existsSync(join(vault, "by-category", "correction.md"))).toBe(true);
    expect(existsSync(join(vault, "by-project", "compiled-project.md"))).toBe(true);

    const decisionPage = readFileSync(join(vault, "by-category", "decision.md"), "utf-8");
    expect(decisionPage).toContain('category: "decision"');
    expect(decisionPage).toContain("first decision");

    const healthPage = readFileSync(join(vault, "_health.md"), "utf-8");
    expect(healthPage).toContain("# Vault health");

    db.close();
  });

  test("project filter exports only matching memories and leaves others alone", async () => {
    const db = await freshDb();
    await upsertProject(db, { id: "p-1", name: "alpha" });
    await upsertProject(db, { id: "p-2", name: "beta" });

    await insertMemory(db, {
      project_id: "p-1", tier: "semantic", category: "fact", trust: "observed",
      content: "alpha memory", context: null, source: "manual", embedding: null,
      weight: 1.0, session_id: null,
    });
    await insertMemory(db, {
      project_id: "p-2", tier: "semantic", category: "fact", trust: "observed",
      content: "beta memory", context: null, source: "manual", embedding: null,
      weight: 1.0, session_id: null,
    });

    const vault = join(tmpRoot, "vault-4");
    // First, full export — both projects represented
    const full = await exportVault(db, { vaultDir: vault });
    expect(full.memories_written).toBe(2);

    // Now filtered export for p-1 only — should write only p-1 files,
    // p-2 files should remain, no garbage collection runs.
    const filtered = await exportVault(db, { vaultDir: vault, projectIdFilter: "p-1" });
    expect(filtered.memories_written).toBe(1);
    expect(filtered.files_removed).toBe(0);
    expect(readdirSync(join(vault, "memories")).length).toBe(2);

    db.close();
  });
});
