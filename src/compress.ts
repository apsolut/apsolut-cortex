import { existsSync, readFileSync, writeFileSync, renameSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { coerceCategory, coerceTier, clampText, CONTENT_MAX, CONTEXT_MAX } from "./validate.js";

const BREAKER_PATH = join(homedir(), ".apsolut-cortex", "compression-state.json");
const MAX_FAILURES = 3;
const COOLDOWN_MS = 60 * 60 * 1000; // 1 hour

export interface BreakerState { failures: number; lastFailure: number }

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

export function getBreakerState(): BreakerState {
  return readBreaker();
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
  // Imported here, not at module load: the SDK is only needed when a key is
  // set and compression actually runs, while this module is imported by the
  // CLI (for the breaker state) and by hooks.
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // Hook budgets are measured in seconds; the SDK's default timeout is 10
  // minutes with retries, which can outlive the hook itself (and, on the
  // PostToolUse synchronous path, freeze a tool call behind it).
  const client = new Anthropic({ timeout: 30_000, maxRetries: 1 });

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
  const MODEL = process.env.APSOLUT_CORTEX_OLLAMA_MODEL ?? "qwen2.5-coder:7b";

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

/** Exported for tests: this is the boundary where model output becomes data. */
export function parseResult(raw: string): CompressionResult {
  const clean = raw.replace(/```json|```/g, "").trim();
  let parsed: { memories?: unknown; summary?: unknown };
  try {
    parsed = JSON.parse(clean);
  } catch {
    // Models occasionally wrap the JSON in prose despite the prompt —
    // retry on the outermost {...} span before giving up.
    const start = clean.indexOf("{");
    const end = clean.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error(`compression output was not JSON: ${clean.slice(0, 120)}`);
    }
    parsed = JSON.parse(clean.slice(start, end + 1));
  }
  return {
    memories: sanitizeMemories(parsed.memories),
    summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 2000) : "",
  };
}

/**
 * Normalize model-authored memory objects into the shape the DB expects.
 *
 * This output used to be cast straight to ExtractedMemory[] and inserted, so a
 * hallucinated `tier: "important"` was stored verbatim and then never matched
 * a tier filter again. Enums are coerced to their defaults, text is clamped,
 * and entries with no usable content are dropped — the memory is worth keeping
 * even when the labels are wrong, but nothing invalid reaches the table.
 */
function sanitizeMemories(raw: unknown): ExtractedMemory[] {
  if (!Array.isArray(raw)) return [];
  const out: ExtractedMemory[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const m = item as Record<string, unknown>;
    const content = typeof m.content === "string" ? clampText(m.content, CONTENT_MAX) : null;
    if (!content) continue;
    out.push({
      tier: coerceTier(m.tier),
      category: coerceCategory(m.category),
      content,
      context: typeof m.context === "string"
        ? (clampText(m.context, CONTEXT_MAX) ?? undefined)
        : undefined,
    });
  }
  return out;
}

export async function compressSession(
  observations: Array<{ tool_name: string | null; content: string; category: string | null }>,
  project: string
): Promise<CompressionResult | null> {
  if (observations.length === 0) {
    return { memories: [], summary: "" };
  }

  // Circuit breaker: skip if too many recent failures
  if (isBreakerOpen()) {
    console.error("[apsolut-cortex] Compression circuit breaker open — skipping (retries in ~1h)");
    return null;
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
      "║  Custom model: APSOLUT_CORTEX_OLLAMA_MODEL=<model>           ║",
      "║                                                              ║",
      "║  Observations were saved. They will be compressed next       ║",
      "║  session when a compression provider is available.           ║",
      "╚══════════════════════════════════════════════════════════════╝",
      "",
    ].join("\n");

    console.error(msg);
    // Observations stay in DB as unprocessed (promoted=0)
    // They'll be included in the next session's compression attempt
    return null;
  }
}

// ── Heuristic classifier for PostToolUse ────────────────────────────────────
// Moved to classify.ts so hooks can use it without loading the Anthropic SDK.
// Re-exported here for callers that still import it from compress.js.
export { classifyToolUse, type ToolUseClassification } from "./classify.js";
