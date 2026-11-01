import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot } from "../memory/memory.js";

export const PROJECT_ARTIFACT_DIR = ".node-cli/project";

export interface ProjectArtifactPaths {
  brief: string;
  decisions: string;
  skillPlan: string;
  plan: string;
}

export function getProjectArtifactDir(projectRoot?: string): string {
  const root = projectRoot ?? findProjectRoot();
  return join(root, PROJECT_ARTIFACT_DIR);
}

export function getProjectArtifactPaths(projectRoot?: string): ProjectArtifactPaths {
  const dir = getProjectArtifactDir(projectRoot);
  return {
    brief: join(dir, "brief.md"),
    decisions: join(dir, "decisions.md"),
    skillPlan: join(dir, "skill-plan.md"),
    plan: join(dir, "plan.md"),
  };
}

export function ensureProjectArtifactDir(projectRoot?: string): string {
  const dir = getProjectArtifactDir(projectRoot);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function artifactExists(
  name: "brief" | "decisions" | "skillPlan" | "plan",
  projectRoot?: string
): boolean {
  return existsSync(getProjectArtifactPaths(projectRoot)[name]);
}

export function readArtifact(
  name: "brief" | "decisions" | "skillPlan" | "plan",
  projectRoot?: string
): string | null {
  const path = getProjectArtifactPaths(projectRoot)[name];
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

export function writeArtifact(
  name: "brief" | "decisions" | "skillPlan" | "plan",
  content: string,
  projectRoot?: string
): void {
  ensureProjectArtifactDir(projectRoot);
  writeFileSync(getProjectArtifactPaths(projectRoot)[name], content, "utf8");
}

export function listProjectArtifactFiles(projectRoot?: string): string[] {
  const dir = getProjectArtifactDir(projectRoot);
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return [];
  }
}

/** Parse milestones from plan.md content. Returns structured milestone objects. */
export function parseMilestonesFromPlan(planContent: string): {
  id: string;
  objective: string;
  status: "pending" | "completed";
}[] {
  const milestones: { id: string; objective: string; status: "pending" | "completed" }[] = [];
  const lines = planContent.split("\n");
  let inMilestones = false;
  for (const line of lines) {
    if (/^##\s+Milestones/i.test(line)) {
      inMilestones = true;
      continue;
    }
    if (inMilestones && /^##\s/.test(line)) {
      inMilestones = false;
      continue;
    }
    if (!inMilestones) continue;
    const match = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
    if (match) {
      const completed = match[1].toLowerCase() === "x";
      const objective = match[2].trim();
      const id = objective.split(":")[0]?.trim() || `milestone-${milestones.length + 1}`;
      milestones.push({ id, objective, status: completed ? "completed" : "pending" });
    }
  }
  return milestones;
}