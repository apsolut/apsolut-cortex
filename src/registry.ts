import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "fs";
import { dirname } from "path";
import { REGISTRY_PATH } from "./db.js";

export interface RegistryEntry {
  name: string;
  path: string;
  registered_at: number;
}

export interface Registry {
  projects: Record<string, RegistryEntry>;
}

export function readRegistry(): Registry {
  if (!existsSync(REGISTRY_PATH)) return { projects: {} };
  try {
    return JSON.parse(readFileSync(REGISTRY_PATH, "utf-8"));
  } catch {
    return { projects: {} };
  }
}

export function writeRegistry(reg: Registry): void {
  const dir = dirname(REGISTRY_PATH);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmp = REGISTRY_PATH + ".tmp";
  writeFileSync(tmp, JSON.stringify(reg, null, 2));
  renameSync(tmp, REGISTRY_PATH);
}

export function registerProject(
  id: string,
  name: string,
  path: string
): void {
  const reg = readRegistry();
  reg.projects[id] = { name, path, registered_at: Date.now() };
  writeRegistry(reg);
}

/**
 * Does `id` belong to `path` on this machine? Returns a refusal message when
 * the registry says that id lives somewhere else, otherwise null.
 *
 * A project id is effectively an authorization token for everything in the
 * database, and it ships in a plain JSON file inside the workspace. Copying a
 * repo — or cloning one that carries a crafted `.apsolut-cortex/project.json`
 * — otherwise claims the original's memories. The registry is machine-local
 * and not copied along with a repo, so it is the authority.
 *
 * An id absent from the registry is allowed: that is a fresh project, or one
 * whose registry entry predates registration. Only a *conflict* is refused.
 */
export function checkProjectBinding(
  id: string,
  path: string,
  registry: Registry = readRegistry()
): string | null {
  const registered = registry.projects[id];
  if (!registered) return null;

  const normalize = (p: string) => p.replace(/[\\/]+$/, "").replace(/\\/g, "/").toLowerCase();
  if (normalize(registered.path) === normalize(path)) return null;

  return (
    `Project id ${id.slice(0, 8)}… is registered to ${registered.path}, but this ` +
    `process is running in ${path}. Refusing to operate on another directory's ` +
    `memories. If this copy should have its own memory, delete ` +
    `.apsolut-cortex/project.json here and run: apsolut-cortex init`
  );
}

export function getProjectByPath(path: string): RegistryEntry & { id: string } | null {
  const reg = readRegistry();
  const entry = Object.entries(reg.projects).find(([, v]) => v.path === path);
  if (!entry) return null;
  return { id: entry[0], ...entry[1] };
}
