import { existsSync, readdirSync, statSync, type Dirent } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../memory/memory.js";

const IMPLEMENTATION_EXTENSIONS = [
  ".ts", ".tsx", ".js", ".jsx", ".py", ".html", ".css", ".go", ".rs", ".java", ".rb", ".php",
];

/**
 * Result of greenfield detection.
 */
export interface GreenfieldResult {
  isGreenfield: boolean;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  implementationFileCount: number;
  hasPackageJson: boolean;
  hasGit: boolean;
  hasNodeCliDir: boolean;
}

/**
 * Heuristics for detecting whether a directory is a greenfield project
 * (little or no implementation code) versus an existing application.
 *
 * A directory is NOT considered greenfield solely because it lacks a .git
 * directory. We look for implementation files, package.json, and existing
 * source structure.
 */
export function detectGreenfield(
  projectRoot: string,
  userRequest: string
): GreenfieldResult {
  const reasons: string[] = [];
  let implementationFileCount = 0;
  let hasMeaningfulSource = false;

  const hasPackageJson = existsSync(join(projectRoot, "package.json"));
  const hasGit = existsSync(join(projectRoot, ".git"));
  const hasNodeCliDir = existsSync(join(projectRoot, ".node-cli"));

  if (existsSync(projectRoot)) {
    try {
      const entries = readdirSync(projectRoot, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (IMPLEMENTATION_EXTENSIONS.includes(ext.toLowerCase())) {
          implementationFileCount += 1;
          try {
            const stat = statSync(join(projectRoot, entry.name));
            if (stat.size > 500) hasMeaningfulSource = true;
          } catch {
            // ignore stat errors
          }
        }
      }
    } catch {
      // directory not readable
    }
  }

  const isBuildRequest = isBuildIntent(userRequest);

  if (!hasPackageJson && !hasGit && implementationFileCount === 0 && isBuildRequest) {
    reasons.push("No package.json, .git, or implementation files found");
    return {
      isGreenfield: true,
      confidence: "high",
      reasons,
      implementationFileCount: 0,
      hasPackageJson: false,
      hasGit: false,
      hasNodeCliDir: false,
    };
  }

  if (implementationFileCount === 0 && !hasMeaningfulSource && isBuildRequest) {
    reasons.push("No implementation files found but project config exists");
    return {
      isGreenfield: true,
      confidence: "medium",
      reasons,
      implementationFileCount: 0,
      hasPackageJson,
      hasGit,
      hasNodeCliDir,
    };
  }

  if (implementationFileCount < 3 && !hasMeaningfulSource && isBuildRequest) {
    reasons.push(
      `Only ${implementationFileCount} implementation file(s); appears to be an early-stage project`
    );
    return {
      isGreenfield: true,
      confidence: "medium",
      reasons,
      implementationFileCount,
      hasPackageJson,
      hasGit,
      hasNodeCliDir,
    };
  }

  reasons.push(
    `${implementationFileCount} implementation file(s) found; existing project`
  );
  return {
    isGreenfield: false,
    confidence: "high",
    reasons,
    implementationFileCount,
    hasPackageJson,
    hasGit,
    hasNodeCliDir,
  };
}

/** Heuristic: does the user request sound like building something new? */
export function isBuildIntent(text: string): boolean {
  const lower = text.toLowerCase();
  const buildVerbs = /\b(build|create|make|new|generate|scaffold|start|implement|convert)\b/;
  const buildNouns = /\b(website|site|app|application|page|project|service|api|library|design|figma)\b/;
  return buildVerbs.test(lower) && buildNouns.test(lower);
}

export function isFigmaIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return /figma\.com|figma design|figma url|figma frame|figma file|implement.*figma|convert.*figma/i.test(lower);
}

/**
 * Count implementation files recursively (shallow, bounded) under a directory.
 */
export function countImplementationFiles(dir: string, maxDepth = 2): number {
  let count = 0;
  function walk(current: string, depth: number): void {
    if (depth > maxDepth) return;
    let entries: Dirent[];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist" || entry.name === ".node-cli") continue;
        walk(full, depth + 1);
      } else if (entry.isFile()) {
        const ext = entry.name.slice(entry.name.lastIndexOf("."));
        if (IMPLEMENTATION_EXTENSIONS.includes(ext.toLowerCase())) count += 1;
      }
    }
  }
  walk(dir, 0);
  return count;
}