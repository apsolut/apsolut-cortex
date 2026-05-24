#!/usr/bin/env bun
/**
 * Cross-platform build script.
 * Excludes heavy native/ML packages from bundling — they resolve at runtime.
 */

import { $ } from "bun";
import { mkdirSync } from "fs";

mkdirSync("dist/mcp", { recursive: true });
mkdirSync("scripts", { recursive: true });

// Packages that must NOT be bundled — resolve from node_modules at runtime
const external = [
  "@huggingface/transformers",
  "@libsql/client",
  "@anthropic-ai/sdk",
  "@modelcontextprotocol/sdk",
  "@napi-rs/keyring",
];

const externalFlags = external.flatMap(p => ["--external", p]);

const entries = [
  { in: "src/cli.ts",                 out: "dist/cli.js" },
  { in: "src/mcp/server.ts",          out: "dist/mcp/server.js" },
  { in: "src/hooks/session-start.ts", out: "scripts/session-start.js" },
  { in: "src/hooks/post-tool-use.ts", out: "scripts/post-tool-use.js" },
  { in: "src/hooks/stop.ts",          out: "scripts/stop.js" },
  { in: "src/hooks/session-end.ts",   out: "scripts/session-end.js" },
];

let failed = false;

for (const { in: input, out: output } of entries) {
  process.stdout.write(`building ${input} → ${output} ... `);
  try {
    await $`bun build ${input} --outfile ${output} --target node ${externalFlags}`.quiet();
    console.log("✓");
  } catch (e) {
    console.log("✗");
    console.error(e);
    failed = true;
  }
}

if (failed) {
  console.error("\nBuild failed.");
  process.exit(1);
} else {
  console.log("\nAll done. dist/ is ready.");
}
