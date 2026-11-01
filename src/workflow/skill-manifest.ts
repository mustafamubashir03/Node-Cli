import { availableSkillIds, getSkillInfo, type SkillAvailability, routingCatalog } from "../skills/registry.js";
import { catalog } from "../config/catalog.js";
import { SkillRouter } from "../skills/router.js";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  SkillManifest,
  SkillManifestEntry,
  SkillLifecycleState,
} from "./types.js";
export type { SkillManifest };

export const DEFAULT_MAX_ACTIVE = 3;
export const DEFAULT_TOKEN_BUDGET = 6000;

/** Mandatory skills for frontend/UI/visual design tasks. */
export const MANDATORY_FRONTEND_SKILLS = ["emil-design-eng", "baseline-ui", "frontend-design"];

/** Mandatory skills for Figma-to-code tasks. */
export const MANDATORY_FIGMA_SKILLS = ["emil-design-eng", "baseline-ui", "frontend-design", "figma-to-code"];

/** Skills that encourage inventing aesthetics — disabled in fidelity mode. */
export const CREATIVE_SKILLS = ["impeccable", "no-ai-slop", "apple-design", "emil-design-eng", "frontend-design", "theme-factory"];

/** Check if a design package exists (fidelity mode). */
export function isFidelityMode(projectRoot?: string): boolean {
  const root = projectRoot || process.cwd();
  try {
    return existsSync(join(root, ".node-cli", "figma"));
  } catch {
    return false;
  }
}

/** Check if a task is frontend-related. */
export function isFrontendTask(task: string): boolean {
  const lower = task.toLowerCase();
  return /\b(website|site|page|landing|html|css|frontend|ui|web app|design|visual|layout|interface)\b/i.test(lower);
}

/** Check if a task is Figma-related. */
export function isFigmaTask(task: string): boolean {
  const lower = task.toLowerCase();
  return /\b(figma|figma.com|figma design|figma url|figma frame|design-to-code)\b/i.test(lower);
}

export function buildSkillManifest({
  taskId,
  task,
  enabledSkills,
  mode,
  planRevision = 0,
}: {
  taskId: string;
  task: string;
  enabledSkills: string[];
  mode: "agent" | "ask" | "plan" | "strict";
  planRevision?: number;
}): SkillManifest {
  const allIds = availableSkillIds();
  const catalogSkills = routingCatalog().skills;
  const enabledSet = new Set(enabledSkills);

  const router = new SkillRouter(catalog, {
    enabledSkills,
    maxActive: DEFAULT_MAX_ACTIVE,
    tokenBudget: DEFAULT_TOKEN_BUDGET,
  });
  const routerResult = router.route(task, { mode, fileTypes: [] });
  const selectedSet = new Set(routerResult.active);

  // Inject mandatory skills for frontend tasks
  const isFrontend = isFrontendTask(task);
  const isFigma = isFigmaTask(task);
  const fidelity = isFidelityMode();
  const mandatorySkills = isFigma ? MANDATORY_FIGMA_SKILLS : (isFrontend ? MANDATORY_FRONTEND_SKILLS : []);
  if (mandatorySkills.length > 0) {
    for (const skillId of mandatorySkills) {
      if (enabledSet.has(skillId)) {
        // In fidelity mode, don't inject creative skills
        if (fidelity && CREATIVE_SKILLS.includes(skillId)) {
          continue;
        }
        selectedSet.add(skillId);
      }
    }
  }

  // In fidelity mode, remove creative skills from selection
  if (fidelity) {
    for (const skillId of CREATIVE_SKILLS) {
      selectedSet.delete(skillId);
    }
  }

  const candidates: SkillManifestEntry[] = [];
  const rejected: string[] = [];
  const unavailable: string[] = [];
  let usedTokens = 0;

  for (const id of allIds) {
    const info = getSkillInfo(id);
    const entry = catalogSkills[id];
    const contextTokens = info?.contextTokens ?? entry?.contextTokens ?? 300;
    const isEnabled = enabledSet.has(id);
    const isSelected = selectedSet.has(id) && isEnabled;

    let lifecycle: SkillLifecycleState = "candidate";
    let rationale: string | undefined;
    let rejectionReason: string | undefined;

    if (info.availability !== "available") {
      unavailable.push(id);
      lifecycle = "rejected";
      rejectionReason = `Unavailable in this build: ${info.reason ?? "not available"}`;
    } else if (isSelected) {
      lifecycle = "selected";
      if (mandatorySkills.includes(id)) {
        rationale = isFigma && MANDATORY_FIGMA_SKILLS.includes(id) && !MANDATORY_FRONTEND_SKILLS.includes(id)
          ? `Mandatory skill for Figma-to-code tasks`
          : `Mandatory skill for frontend tasks`;
      } else {
        rationale = `Selected by router for: ${task.slice(0, 80)}`;
      }
      usedTokens += contextTokens;
    } else {
      rejected.push(id);
      rejectionReason = "Not selected: lower router priority or budget exhausted";
    }

    candidates.push({
      id,
      availability: info.availability,
      availabilityReason: info.reason ?? undefined,
      selected: isSelected,
      rationale,
      rejectionReason,
      phase: inferPhase(id),
      lifecycle,
      contextTokens,
      loaded: false,
      requested: false,
      applied: false,
    });
  }

  candidates.sort((a, b) => {
    if (a.selected && !b.selected) return -1;
    if (!a.selected && b.selected) return 1;
    return a.contextTokens - b.contextTokens;
  });

  return {
    taskId,
    task,
    candidates,
    selected: [...new Set([...routerResult.active.filter((id) => enabledSet.has(id)), ...mandatorySkills.filter((id) => enabledSet.has(id))])],
    rejected,
    unavailable,
    budget: {
      used: usedTokens,
      limit: DEFAULT_TOKEN_BUDGET,
      over: usedTokens > DEFAULT_TOKEN_BUDGET,
    },
    approved: false,
    planRevision,
    revision: 0,
  };
}

function inferPhase(id: string): "discovery" | "design" | "implementation" | "verification" {
  const verification = [
    "verification-before-completion",
    "webapp-testing",
    "core-web-vitals",
    "web-quality-audit",
    "accessibility",
  ];
  const design = [
    "frontend-design",
    "baseline-ui",
    "apple-design",
    "emil-design-eng",
    "improve-animations",
    "review-animations",
    "web-design-guidelines",
    "theme-factory",
    "pick-ui-library",
    "beautify",
    "hallmark",
    "impeccable",
  ];
  const discovery = ["writing-plans", "systematic-debugging", "best-practices"];

  if (verification.includes(id)) return "verification";
  if (design.includes(id)) return "design";
  if (discovery.includes(id)) return "discovery";
  return "implementation";
}

export function updateManifestLifecycle(
  manifest: SkillManifest,
  skillId: string,
  state: SkillLifecycleState,
  detail?: { rationale?: string; rejectionReason?: string }
): boolean {
  const entry = manifest.candidates.find((c: SkillManifestEntry) => c.id === skillId);
  if (!entry) return false;

  entry.lifecycle = state;
  switch (state) {
    case "loaded":
      entry.loaded = true;
      break;
    case "requested":
      entry.requested = true;
      break;
    case "applied":
      entry.applied = true;
      break;
    case "rejected":
      if (detail?.rejectionReason) entry.rejectionReason = detail.rejectionReason;
      break;
  }
  if (detail?.rationale) entry.rationale = detail.rationale;
  return true;
}

export function approveManifest(
  manifest: SkillManifest,
  planRevision: number
): SkillManifest {
  manifest.approved = true;
  manifest.approvedAt = new Date().toISOString();
  manifest.planRevision = planRevision;
  manifest.revision += 1;
  return manifest;
}

export function invalidateManifestApproval(manifest: SkillManifest): SkillManifest {
  manifest.approved = false;
  manifest.approvedAt = undefined;
  manifest.revision += 1;
  return manifest;
}

export function manifestSummary(manifest: SkillManifest): string {
  const selected = manifest.selected.join(", ") || "none";
  const rejected = manifest.rejected.length;
  const unavailable = manifest.unavailable.length;
  const loaded = manifest.candidates.filter((c: SkillManifestEntry) => c.loaded).length;
  const requested = manifest.candidates.filter((c: SkillManifestEntry) => c.requested).length;
  const applied = manifest.candidates.filter((c: SkillManifestEntry) => c.applied).length;
  return (
    `selected=${selected}, rejected=${rejected}, unavailable=${unavailable}, ` +
    `loaded=${loaded}, requested=${requested}, applied=${applied}, ` +
    `budget=${manifest.budget.used}/${manifest.budget.limit}`
  );
}
