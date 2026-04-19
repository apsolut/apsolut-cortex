import Anthropic from "@anthropic-ai/sdk";
import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const BREAKER_PATH = join(homedir(), ".apsolut-cortex", "compression-state.json");
const MAX_FAILURES = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

interface BreakerState { failures: number; lastFailure: number }

function readBreaker(): BreakerState {
  try {
    if (existsSync(BREAKER_PATH)) return JSON.parse(readFileSync(BREAKER_PATH, "utf-8"));
  } catch {}
  return { failures: 0, lastFailure: 0 };
}

function writeBreaker(state: BreakerState): void {
  try {
    const tmp = BREAKER_PATH + ".tmp";
    writeFileSync(tmp, JSON.stringify(state));
    renameSync(tmp, BREAKER_PATH);
  } catch {}
}

function isBreakerOpen(): boolean {
  const state = readBreaker();
  return state.failures >= MAX_FAILURES && (Date.now() - state.lastFailure) < COOLDOWN_MS;
}

function recordFailure(): void {
  const state = readBreaker();
  writeBreaker({ failures: state.failures + 1, lastFailure: Date.now() });
}

function resetBreaker(): void {
  writeBreaker({ failures: 0, lastFailure: 0 });
}

export interface ExtractedMemory {
  tier: "episodic" | "semantic" | "procedural" | "strategic" | "meta";
  category: "correction" | "insight" | "decision" | "discovery" | "fact" | "pattern";
  content: string;
  context?: string;
}

export interface CompressionResult {
  memories: ExtractedMemory[];
  summary: string;
}

const SYSTEM_PROMPT = `You are analyzing a Claude Code session to extract durable memories and write a session summary.

Given observations from a coding session, output ONLY valid JSON with this shape:
{
  "memories": [
    {
      "tier": "episodic|semantic|procedural|strategic|meta",
      "category": "correction|insight|decision|discovery|fact|pattern",
      "content": "specific, actionable, one sentence",
      "context": "optional: what was happening"
    }
  ],
  "summary": "2-3 sentence human-readable recap of this session"
}

Memory tiers:
- episodic: specific events, what happened, corrections
- semantic: stable facts about the codebase
- procedural: how-to patterns, SOPs, step-by-step knowledge
- strategic: architectural decisions, conventions, non-negotiables
- meta: how to work effectively with this project

Rules:
- Max 5 memories. Fewer if the session was simple.
- Corrections (tried X, actually Y) get highest priority — always store these
- Skip temporary or task-specific details
- Be concrete: file paths, library names, specific patterns
- Summary should help the next session pick up context fast
- If nothing worth preserving happened, return {"memories":[],"summary":"Short session with no significant findings."}
- Return ONLY the JSON object, no markdown, no preamble`;

async function compressWithAnthropic(
  observations: Array<{ tool_name: string | null; content: string; category: string | null }>,
  project: string
): Promise<CompressionResult> {
  const client = new Anthropic();

  const obsText = observations
    .map((o, i) =>
      `[${i + 1}]${o.tool_name ? ` Tool: ${o.tool_name}` : ""}\n${o.content}`
    )
    .join("\n\n---\n\n");

  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Project: ${project}\n\nSession observations:\n\n${obsText}`,
      },
    ],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  return parseResult(text);
}

async function compressWithOllama(
  observations: Array<{ tool_name: string | null; content: string; category: string | null }>,
  project: string
): Promise<CompressionResult> {
  const OLLAMA_URL = process.env.OLLAMA_HOST ?? "http://localhost:11434";
  const MODEL = process.env.CORTEX_OLLAMA_MODEL ?? "qwen2.5-coder:7b";

  const obsText = observations
    .map((o, i) =>
      `[${i + 1}]${o.tool_name ? ` Tool: ${o.tool_name}` : ""}\n${o.content}`
    )
    .join("\n\n---\n\n");

  const response = await fetch(`${OLLAMA_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      prompt: `${SYSTEM_PROMPT}\n\nProject: ${project}\n\nSession observations:\n\n${obsText}\n\nRespond ONLY with valid JSON:`,
      stream: false,
    }),
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    throw new Error(`Ollama returned ${response.status}: ${await response.text()}`);
  }

  const data = (await response.json()) as { response: string };
  return parseResult(data.response);
}

function parseResult(raw: string): CompressionResult {
  const clean = raw.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);
  return {
    memories: Array.isArray(parsed.memories) ? parsed.memories : [],
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
  };
}

export async function compressSession(
  observations: Array<{ tool_name: string | null; content: string; category: string | null }>,
  project: string
): Promise<CompressionResult> {
  if (observations.length === 0) {
    return { memories: [], summary: "" };
  }

  // Circuit breaker: skip if too many recent failures
  if (isBreakerOpen()) {
    console.error("[apsolut-cortex] Compression circuit breaker open — skipping (retries in ~1h)");
    return { memories: [], summary: "" };
  }

  // Primary: Anthropic API
  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const result = await compressWithAnthropic(observations, project);
      resetBreaker();
      return result;
    } catch (e) {
      console.error(`[apsolut-cortex] Haiku compression failed: ${e}`);
      console.error("[apsolut-cortex] Falling back to Ollama...");
    }
  }

  // Fallback: Ollama
  try {
    const result = await compressWithOllama(observations, project);
    resetBreaker();
    console.error("[apsolut-cortex] Used Ollama for compression.");
    return result;
  } catch (e) {
    recordFailure();
    const msg = [
      "",
      "╔══════════════════════════════════════════════════════════════╗",
      "║  apsolut-cortex: SESSION COMPRESSION FAILED                 ║",
      "║                                                              ║",
      "║  Neither Anthropic API nor Ollama is available.             ║",
      "║                                                              ║",
      "║  To fix:                                                     ║",
      "║  Option 1: Set ANTHROPIC_API_KEY in your environment         ║",
      "║  Option 2: Run Ollama locally (ollama serve)                 ║",
      "║            Default model: qwen2.5-coder:7b                  ║",
      "║            Custom model:  CORTEX_OLLAMA_MODEL=<model>        ║",
      "║                                                              ║",
      "║  Observations were saved. They will be compressed next       ║",
      "║  session when a compression provider is available.           ║",
      "╚══════════════════════════════════════════════════════════════╝",
      "",
    ].join("\n");

    console.error(msg);
    // Return empty result — observations stay in DB as unprocessed (promoted=0)
    // They'll be included in the next session's compression attempt
    return { memories: [], summary: "" };
  }
}

// ── Heuristic classifier for PostToolUse ────────────────────────────────────

export function classifyToolUse(
  toolName: string,
  toolInput: unknown,
  toolResponse: unknown
): { worth_storing: boolean; category: string; summary: string } | null {
  const output = JSON.stringify(toolResponse ?? "").toLowerCase();
  const input = JSON.stringify(toolInput ?? "").toLowerCase();

  // Tool failures — only store actual errors, not exploratory "not found"
  const isError =
    output.includes('"error"') ||
    output.includes('"failed"') ||
    output.includes("error:") ||
    output.includes("permission denied") ||
    output.includes("enoent") ||
    output.includes("cannot find module");

  // "not found" only counts for write/execute tools, not reads (which are often exploratory)
  const readTools = ["read", "glob", "grep", "search", "list"];
  const isReadTool = readTools.some((t) => toolName.toLowerCase().includes(t));
  const isNotFoundError = output.includes("not found") && !isReadTool;

  if (isError || isNotFoundError) {
    return {
      worth_storing: true,
      category: "correction",
      summary: `${toolName} failed: ${JSON.stringify(toolResponse)?.slice(0, 300)}`,
    };
  }

  // File edits — store as change
  if (toolName === "Edit" || toolName === "Write") {
    const filePath = (toolInput as Record<string, unknown>)?.file_path ?? "";
    return {
      worth_storing: true,
      category: "change",
      summary: `${toolName}: ${String(filePath).slice(-120)}`,
    };
  }

  // Test runs — store as pattern
  const testPatterns = ["jest", "vitest", "pytest", "mocha", "bun test", "npm test", "cargo test", "go test"];
  if (toolName === "Bash" && testPatterns.some((p) => input.includes(p))) {
    const passed = output.includes("pass") && !output.includes("fail");
    return {
      worth_storing: true,
      category: "pattern",
      summary: `Tests ${passed ? "passed" : "failed"}: ${JSON.stringify(toolInput)?.slice(0, 150)}`,
    };
  }

  // Dependency installs — store as discovery
  const installPatterns = ["npm install", "npm add", "bun add", "bun install", "pip install", "cargo add", "go get"];
  if (toolName === "Bash" && installPatterns.some((p) => input.includes(p))) {
    return {
      worth_storing: true,
      category: "discovery",
      summary: `Dependency: ${JSON.stringify(toolInput)?.slice(0, 200)}`,
    };
  }

  // Config file reads — store as discovery
  const configPatterns = [
    "package.json", "tsconfig", ".env", "cargo.toml",
    "pyproject.toml", "go.mod", "composer.json", "gemfile",
    ".eslintrc", "vite.config", "next.config", "drizzle.config",
  ];
  if (
    toolName === "Read" &&
    configPatterns.some((p) => input.includes(p))
  ) {
    return {
      worth_storing: true,
      category: "discovery",
      summary: `Read config: ${JSON.stringify(toolInput)?.slice(0, 150)}`,
    };
  }

  return null;
}
