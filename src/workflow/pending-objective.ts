/**
 * Pending objective storage for friction removal.
 * After /figma-to-code, store a pending objective in .node-cli/state.
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const STATE_DIR = join(process.cwd(), ".node-cli", "state");
const PENDING_FILE = join(STATE_DIR, "pending-objective.json");

export interface PendingObjective {
  objective: string;
  packagePath: string;
  createdAt: string;
}

export function storePendingObjective(objective: string, packagePath: string): void {
  if (!existsSync(STATE_DIR)) mkdirSync(STATE_DIR, { recursive: true });
  const po: PendingObjective = { objective, packagePath, createdAt: new Date().toISOString() };
  writeFileSync(PENDING_FILE, JSON.stringify(po, null, 2));
}

export function getPendingObjective(): PendingObjective | null {
  if (!existsSync(PENDING_FILE)) return null;
  try {
    return JSON.parse(readFileSync(PENDING_FILE, "utf8"));
  } catch {
    return null;
  }
}

export function clearPendingObjective(): void {
  if (existsSync(PENDING_FILE)) {
    try { unlinkSync(PENDING_FILE); } catch { /* ignore */ }
  }
}

const RESOLVE_PATTERNS = ["yes", "go", "do it", "all", "do everything", "do 1", "these steps", "build now", "start"];

export function resolvesPendingObjective(input: string): boolean {
  const lower = input.trim().toLowerCase();
  return RESOLVE_PATTERNS.some((p) => lower === p || lower.startsWith(p + " "));
}