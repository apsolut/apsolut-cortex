/**
 * Heuristic classifier for PostToolUse / PostToolUseFailure payloads.
 *
 * Lives in its own module — with no dependencies — because it runs on the
 * hot path. It used to be exported from compress.ts, so every PostToolUse
 * invocation loaded the Anthropic SDK (and everything compress.ts pulls in)
 * just to run a handful of string tests.
 */

export interface ToolUseClassification {
  worth_storing: boolean;
  category: string;
  summary: string;
}

export function classifyToolUse(
  toolName: string,
  toolInput: unknown,
  toolResponse: unknown
): ToolUseClassification | null {
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
