/**
 * Fidelity mode: true when .node-cli/figma/ holds a package.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

export function isFidelityMode(workspaceRoot: string = process.cwd()): boolean {
  const figmaDir = join(workspaceRoot, ".node-cli", "figma");
  if (!existsSync(figmaDir)) return false;
  try {
    const entries = readdirSync(figmaDir, { withFileTypes: true });
    return entries.some((e) => e.isDirectory());
  } catch {
    return false;
  }
}