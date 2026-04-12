import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
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
  writeFileSync(REGISTRY_PATH, JSON.stringify(reg, null, 2));
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

export function getProjectByPath(path: string): RegistryEntry & { id: string } | null {
  const reg = readRegistry();
  const entry = Object.entries(reg.projects).find(([, v]) => v.path === path);
  if (!entry) return null;
  return { id: entry[0], ...entry[1] };
}
