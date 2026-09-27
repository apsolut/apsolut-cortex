/**
 * Reading and writing cortex's hook registration in Claude Code settings.
 *
 * Extracted from cli.ts so the merge/strip logic can be tested: it edits the
 * user's settings.json, where a mistake either silently disables capture or
 * deletes somebody else's hooks.
 *
 * Scope policy: hooks belong to the project (`.claude/settings.local.json`),
 * not the machine. Registered in `~/.claude/settings.json` they fire in every
 * project on the box, which measured ~700 ms of Node startup per tool call in
 * repositories that have nothing to do with cortex.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname } from "path";

/** Every event cortex has ever registered — used when cleaning up. */
export const ALL_HOOK_EVENTS = [
  "SessionStart", "UserPromptSubmit", "PostToolUse", "PostToolUseFailure",
  "Stop", "SessionEnd", "PreCompact",
] as const;

export interface HookCommand {
  type: string;
  command: string;
  async?: boolean;
  asyncRewake?: boolean;
  timeout?: number;
}

export interface HookEntry {
  matcher: string;
  hooks: HookCommand[];
}

export function readJsonFile(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {};
  try { return JSON.parse(readFileSync(path, "utf-8")); } catch { return {}; }
}

/** True when a settings hook entry (either format, old or new) is ours. */
export function isCortexEntry(e: unknown): boolean {
  if (!e || typeof e !== "object") return false;
  const entry = e as { hooks?: Array<{ command?: string }>; command?: string };
  if (Array.isArray(entry.hooks)) {
    return entry.hooks.some((h) => h.command?.includes("apsolut-cortex"));
  }
  return Boolean(entry.command?.includes("apsolut-cortex"));
}

/**
 * The full modern hook set.
 *
 * `async: true` (Claude Code ≥ 2.1.196) keeps capture-only hooks off the
 * critical path; older versions ignore the field and run them synchronously as
 * before. SessionStart and UserPromptSubmit stay sync — they return context
 * output. PreCompact uses asyncRewake so a failed emergency capture wakes
 * Claude instead of dying silently.
 */
export function buildHookEntries(hookCmd: string): Record<string, HookEntry[]> {
  const cmd = (name: string, extra: Partial<HookCommand> = {}): HookEntry[] => [
    { matcher: "", hooks: [{ type: "command", command: `${hookCmd} hook:${name}`, ...extra }] },
  ];
  return {
    SessionStart:       cmd("session-start"),
    UserPromptSubmit:   cmd("user-prompt-submit"),
    PostToolUse:        cmd("post-tool-use", { async: true }),
    PostToolUseFailure: cmd("post-tool-use", { async: true }),
    Stop:               cmd("stop", { async: true }),
    SessionEnd:         cmd("session-end"),
    PreCompact:         cmd("pre-compact", { timeout: 60, asyncRewake: true }),
  };
}

/**
 * Write cortex's hook entries into a settings file, replacing any previous
 * cortex entries and leaving other tools' hooks untouched. Returns the number
 * of events written, or null if the file could not be written.
 */
export function writeHooks(
  settingsPath: string,
  entries: Record<string, HookEntry[]>
): number | null {
  try {
    const dir = dirname(settingsPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const settings = readJsonFile(settingsPath);
    const hooks = (settings.hooks as Record<string, unknown[]>) ?? {};
    for (const [event, eventEntries] of Object.entries(entries)) {
      const others = ((hooks[event] ?? []) as unknown[]).filter((e) => !isCortexEntry(e));
      hooks[event] = [...others, ...eventEntries];
    }
    settings.hooks = hooks;
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return Object.keys(entries).length;
  } catch {
    return null;
  }
}

/**
 * Strip cortex hook entries from a settings file. Returns how many entries were
 * removed (0 if the file doesn't exist or held none).
 */
export function stripHooks(settingsPath: string): number {
  if (!existsSync(settingsPath)) return 0;
  try {
    const settings = readJsonFile(settingsPath);
    const hooks = settings.hooks as Record<string, unknown[]> | undefined;
    if (!hooks) return 0;
    let removed = 0;
    for (const event of ALL_HOOK_EVENTS) {
      const current = hooks[event];
      if (!Array.isArray(current)) continue;
      const kept = current.filter((e) => !isCortexEntry(e));
      removed += current.length - kept.length;
      if (kept.length === 0) delete hooks[event];
      else hooks[event] = kept;
    }
    if (removed > 0) writeFileSync(settingsPath, JSON.stringify(settings, null, 2));
    return removed;
  } catch {
    return 0;
  }
}

/** Which scopes currently hold cortex hooks, and for which events. */
export function findRegisteredHooks(
  scopes: Array<{ label: string; path: string }>
): Array<{ label: string; events: string[] }> {
  const out: Array<{ label: string; events: string[] }> = [];
  for (const { label, path } of scopes) {
    const hooks = readJsonFile(path).hooks as Record<string, unknown[]> | undefined;
    if (!hooks) continue;
    const events = ALL_HOOK_EVENTS.filter(
      (e) => Array.isArray(hooks[e]) && hooks[e].some(isCortexEntry)
    );
    if (events.length > 0) out.push({ label, events: [...events] });
  }
  return out;
}
