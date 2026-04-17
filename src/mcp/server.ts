#!/usr/bin/env bun
/**
 * apsolut-cortex MCP server (stdio)
 *
 * Tools:
 *   memory_search      — hybrid BM25 + vector + RRF + MMR
 *   memory_store       — explicitly store a memory
 *   memory_rate        — RL feedback on retrieved memory
 *   memory_contradict  — delete wrong memory, optionally replace
 *   memory_status      — stats for current project
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync, existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import {
  getDb,
  upsertProject,
  insertMemory,
  updateWeight,
  searchBM25,
  searchVector,
  mergeRRF,
  applyMMR,
  findDuplicate,
  bumpWeight,
  type MemoryTier,
  type MemoryCategory,
  type Memory,
} from "../db.js";
import { embed } from "../embed.js";
import { stripPrivate } from "../privacy.js";
import {
  CORTEX_SEARCH_LIMIT_MAX,
  CORTEX_SEARCH_MULTIPLIER,
  CORTEX_CORRECTION_WEIGHT,
  CORTEX_MANUAL_WEIGHT,
} from "../config.js";

// Resolve project from env or cwd
const PROJECT_PATH = process.env.APSOLUT_PROJECT_PATH ?? process.cwd();
const projectFile = join(PROJECT_PATH, ".apsolut", "project.json");

let project: { id: string; name: string } | null = null;
if (existsSync(projectFile)) {
  try {
    project = JSON.parse(readFileSync(projectFile, "utf-8"));
  } catch {}
}

const db = await getDb();
if (project?.id) {
  await upsertProject(db, { id: project.id, name: project.name, path: PROJECT_PATH });
}

const __mcp_dirname = dirname(fileURLToPath(import.meta.url));
const PKG_VERSION = JSON.parse(readFileSync(resolve(__mcp_dirname, "..", "..", "package.json"), "utf-8")).version;

const server = new Server(
  { name: "apsolut-cortex", version: PKG_VERSION },
  { capabilities: { tools: {} } }
);

function requireProject(): { id: string; name: string } {
  if (!project?.id) throw new Error(
    "No project found. Run: apsolut-cortex init"
  );
  return project;
}

async function hybridSearch(
  projectId: string,
  query: string,
  limit: number
): Promise<Memory[]> {
  const fetchCount = limit * CORTEX_SEARCH_MULTIPLIER;
  const bm25 = await searchBM25(db, projectId, query, fetchCount);

  let vectorResults: Array<Memory & { similarity: number }> = [];
  let queryEmb: Float32Array | null = null;
  try {
    queryEmb = await embed(query);
    vectorResults = await searchVector(db, projectId, queryEmb, fetchCount);
  } catch (e) {
    console.error(`[apsolut-cortex] search embedding failed, falling back to BM25: ${e}`);
  }

  // Build combined map
  const allItems = new Map<string, Memory>();
  bm25.forEach((m) => allItems.set(m.id, m));
  vectorResults.forEach((m) => allItems.set(m.id, m));

  // Merge with RRF
  const merged = mergeRRF(bm25, vectorResults, fetchCount, allItems);

  // Apply MMR for diversity
  const withSimilarity = merged.map((m) => ({
    ...m,
    similarity: vectorResults.find((v) => v.id === m.id)?.similarity ?? 0,
  }));

  return applyMMR(withSimilarity, queryEmb, limit);
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_search",
      description:
        "Search project memory for relevant context. Use when you need to recall decisions, patterns, corrections, or facts about this project. Triggered by user saying 'remember <topic>' or when you're uncertain about project-specific details.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Topic or question to search for" },
          limit: { type: "number", description: "Max results, default 5" },
          tier: {
            type: "string",
            enum: ["episodic", "semantic", "procedural", "strategic", "meta"],
            description: "Optional: filter to a specific memory tier",
          },
          trust: {
            type: "string",
            enum: ["observed", "validated", "proven", "canonical"],
            description: "Optional: filter to a minimum trust level",
          },
        },
        required: ["query"],
      },
    },
    {
      name: "memory_store",
      description:
        "Store something important about this project. Use when you make a correction, discover something about the codebase, reach a decision, or find a pattern worth preserving.",
      inputSchema: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "The memory — specific, actionable, one clear sentence",
          },
          category: {
            type: "string",
            enum: ["correction", "insight", "decision", "discovery", "fact", "pattern"],
            description:
              "correction=I was wrong about X; insight=I learned X; decision=we decided X; fact=stable fact; pattern=recurring pattern",
          },
          tier: {
            type: "string",
            enum: ["episodic", "semantic", "procedural", "strategic", "meta"],
            description:
              "episodic=specific event; semantic=general fact; procedural=how-to; strategic=architectural decision; meta=how to work with this project",
          },
          context: {
            type: "string",
            description: "Optional: what was happening when you stored this",
          },
        },
        required: ["content", "category"],
      },
    },
    {
      name: "memory_rate",
      description:
        "Rate a memory you retrieved — helps the system learn what's useful. Always call this after using results from memory_search.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Memory ID from memory_search result" },
          score: {
            type: "number",
            description: "0=useless/ignored, 1=marginally relevant, 2=helpful context, 3=directly applied",
          },
        },
        required: ["id", "score"],
      },
    },
    {
      name: "memory_contradict",
      description:
        "Mark a memory as wrong and optionally replace it with the correct information.",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "ID of the wrong memory" },
          correction: {
            type: "string",
            description: "Optional: what the correct information actually is",
          },
        },
        required: ["id"],
      },
    },
    {
      name: "memory_status",
      description: "Show memory stats for this project.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    switch (name) {
      case "memory_search": {
        const p = requireProject();
        const query = String(args?.query ?? "");
        const limit = Math.min(Number(args?.limit ?? 5), CORTEX_SEARCH_LIMIT_MAX);
        const tierFilter = args?.tier as MemoryTier | undefined;
        const trustFilter = args?.trust as string | undefined;

        let results = await hybridSearch(p.id, query, limit * CORTEX_SEARCH_MULTIPLIER);

        if (tierFilter) results = results.filter((m) => m.tier === tierFilter);
        if (trustFilter) {
          const trustOrder = ["observed", "validated", "proven", "canonical"];
          const minIdx = trustOrder.indexOf(trustFilter);
          results = results.filter(
            (m) => trustOrder.indexOf(m.trust) >= minIdx
          );
        }

        results = results.slice(0, limit);

        if (results.length === 0) {
          return {
            content: [{
              type: "text",
              text: `No memories found for "${query}" in project ${p.name}.\n\nYou can store something with memory_store.`,
            }],
          };
        }

        const text = results
          .map((r, i) => {
            const age = Math.round(
              (Date.now() - r.created_at) / (24 * 60 * 60 * 1000)
            );
            return [
              `[${i + 1}] ID: ${r.id}`,
              `    ${r.tier}/${r.category} · trust: ${r.trust} · weight: ${r.weight.toFixed(2)} · ${age}d ago`,
              `    ${r.content}`,
              r.context ? `    Context: ${r.context}` : "",
            ]
              .filter(Boolean)
              .join("\n");
          })
          .join("\n\n");

        return {
          content: [{
            type: "text",
            text: `Found ${results.length} memories for "${query}":\n\n${text}\n\nCall memory_rate(id, score) after using these.`,
          }],
        };
      }

      case "memory_store": {
        const p = requireProject();
        const rawContent = String(args?.content ?? "").trim();
        const content = stripPrivate(rawContent) ?? "";
        const category = (args?.category ?? "insight") as MemoryCategory;
        const tier = (args?.tier ?? "semantic") as MemoryTier;
        const context = args?.context ? stripPrivate(String(args.context)) : null;

        if (!content) {
          return { content: [{ type: "text", text: "Error: content is required (or entirely private)" }] };
        }

        const textToEmbed = context ? `${content} ${context}` : content;
        let embeddingRaw: Float32Array | null = null;
        try {
          embeddingRaw = await embed(textToEmbed);
        } catch (e) {
          console.error(`[apsolut-cortex] embedding failed for store: ${e}`);
        }

        // Dedup: if a very similar memory exists, bump its weight instead
        if (embeddingRaw) {
          const dup = await findDuplicate(db, p.id, embeddingRaw);
          if (dup) {
            await bumpWeight(db, dup.id);
            return {
              content: [{
                type: "text",
                text: `Similar memory already exists (${dup.id}). Boosted its weight instead of duplicating.`,
              }],
            };
          }
        }

        const weight = category === "correction" ? CORTEX_CORRECTION_WEIGHT : CORTEX_MANUAL_WEIGHT;

        const id = await insertMemory(db, {
          project_id: p.id,
          tier,
          category,
          trust: "observed",
          content,
          context,
          source: "manual",
          embedding: embeddingRaw,
          weight,
          session_id: null,
        });

        return {
          content: [{
            type: "text",
            text: `Stored memory ${id}\n${tier}/${category}: ${content}`,
          }],
        };
      }

      case "memory_rate": {
        const id = String(args?.id ?? "");
        const score = Math.min(3, Math.max(0, Math.round(Number(args?.score ?? 1)))) as 0 | 1 | 2 | 3;

        if (!id) {
          return { content: [{ type: "text", text: "Error: id is required" }] };
        }

        await updateWeight(db, id, score);

        const labels = ["useless", "marginal", "helpful", "directly applied"];
        return {
          content: [{
            type: "text",
            text: `Rated memory ${id}: ${score}/3 (${labels[score]}). Weight updated.`,
          }],
        };
      }

      case "memory_contradict": {
        const p = requireProject();
        const id = String(args?.id ?? "");
        const correction = args?.correction ? String(args.correction) : null;

        if (!id) {
          return { content: [{ type: "text", text: "Error: id is required" }] };
        }

        await db.execute({ sql: "DELETE FROM memories WHERE id = ?", args: [id] });

        let newId: string | null = null;
        if (correction) {
          let embedding: Float32Array | null = null;
          try {
            embedding = await embed(correction);
          } catch (e) {
            console.error(`[apsolut-cortex] embedding failed for correction: ${e}`);
          }

          newId = await insertMemory(db, {
            project_id: p.id,
            tier: "episodic",
            category: "correction",
            trust: "observed",
            content: correction,
            context: `Replaced wrong memory ${id}`,
            source: "manual",
            embedding,
            weight: CORTEX_CORRECTION_WEIGHT,
            session_id: null,
          });
        }

        return {
          content: [{
            type: "text",
            text: correction
              ? `Deleted wrong memory ${id}. Stored correction as ${newId}.`
              : `Deleted wrong memory ${id}.`,
          }],
        };
      }

      case "memory_status": {
        const p = requireProject();

        const statsResult = await db.execute({
          sql: `SELECT tier, category, trust,
                       COUNT(*) as count,
                       ROUND(AVG(weight), 2) as avg_weight,
                       SUM(used_count) as total_uses
                FROM memories
                WHERE project_id = ?
                GROUP BY tier, category, trust
                ORDER BY tier, category, trust`,
          args: [p.id],
        });

        const stats = statsResult.rows as Array<{
          tier: string; category: string; trust: string;
          count: number; avg_weight: number; total_uses: number;
        }>;

        const total = stats.reduce((s, r) => s + (r.count as number), 0);

        const sessionsResult = await db.execute({
          sql: "SELECT COUNT(*) as n FROM sessions WHERE project_id = ?",
          args: [p.id],
        });
        const sessionCount = sessionsResult.rows[0]?.n as number ?? 0;

        const summaryResult = await db.execute({
          sql: `SELECT summary FROM sessions
                WHERE project_id = ? AND summary IS NOT NULL
                ORDER BY started_at DESC LIMIT 1`,
          args: [p.id],
        });
        const lastSummary = summaryResult.rows[0]?.summary as string | undefined;

        const lines = [
          `Project: ${p.name}`,
          `Total memories: ${total} across ${sessionCount} sessions`,
          "",
          ...stats.map(
            (r) =>
              `  ${r.tier}/${r.category} [${r.trust}] — ${r.count} memories, avg weight ${r.avg_weight}, ${r.total_uses} uses`
          ),
        ];

        if (lastSummary) {
          lines.push("", "Last session:", `  ${lastSummary}`);
        }

        return { content: [{ type: "text", text: lines.join("\n") }] };
      }

      default:
        return { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
    }
  } catch (e) {
    return {
      content: [{
        type: "text",
        text: `Error: ${e instanceof Error ? e.message : String(e)}`,
      }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
