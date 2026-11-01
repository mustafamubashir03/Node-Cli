import type { ToolDecision } from "../agent/permissions.js";
import type { TaskContext, WorkflowId } from "./types.js";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { getProjectArtifactPaths } from "./plan-artifacts.js";
import {
    readApprovalState,
    writeApprovalState,
    createDefaultApprovalState,
    type ApprovalStateRecord,
    getApprovalStatePath,
} from "./approval-state.js";

const WRITE_TOOLS = new Set(["Edit", "Write", "Bash", "NotebookEdit", "UseSkill"]);

/** Extract a file path from tool input. */
function getPathFromInput(input: Record<string, unknown>): string | null {
  const rawTarget = ["file_path", "path", "notebook_path"]
    .map((key) => input[key])
    .find((value) => typeof value === "string" && value.length > 0) as string | undefined;
  return rawTarget ?? null;
}

/** Internal state files and directories that are never writable by the model. */
const INTERNAL_STATE_PATTERNS = [
    ".node-cli/sessions/",
    ".node-cli/project/task-context",
    ".node-cli/state/",
    ".node-cli/project/plan.md",
    ".node-cli/project/decisions.md",
    ".node-cli/project/skill-plan.md",
];

/** Planning artifacts that are writable during the planning phase (brief only). */
const PLANNING_ARTIFACTS = ["brief.md"];

/** Compute a SHA-256 hash of the plan file content for integrity checking. */
export function computePlanHash(projectRoot?: string): string | null {
  const paths = getProjectArtifactPaths(projectRoot);
  if (!existsSync(paths.plan)) return null;
  try {
    const content = readFileSync(paths.plan, "utf8");
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

/** Compute a combined hash of all approved artifacts for integrity checking. */
export function computeArtifactsHash(projectRoot?: string): string | null {
  const paths = getProjectArtifactPaths(projectRoot);
  const parts: string[] = [];
  for (const name of ["brief", "decisions", "skillPlan", "plan"] as const) {
    const p = paths[name];
    if (existsSync(p)) {
      try {
        parts.push(name + ":" + createHash("sha256").update(readFileSync(p, "utf8")).digest("hex"));
      } catch {
        // skip unreadable
      }
    }
  }
  if (parts.length === 0) return null;
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

let activeGate: ApprovalGate | null = null;

export function getActiveApprovalGate(): ApprovalGate | null {
  return activeGate;
}

export function setActiveApprovalGate(gate: ApprovalGate | null): void {
  activeGate = gate;
}

export function clearActiveApprovalGate(): void {
  activeGate = null;
}

/**
 * Runtime approval gate for plan-first workflows.
 *
 * When a task is in `plan_approve_build` mode and the plan has not been
 * approved for the current plan revision, project-mutating tools are denied.
 * Read-only tools remain available.
 *
 * This is enforced at the tool-execution boundary (canUseTool), not merely
 * in the system prompt.
 */
export class ApprovalGate {
  private context: TaskContext;
  private pendingApproval = false;
  private statePath: string;
  private state: ApprovalStateRecord;

  constructor(context: TaskContext, planHash?: string | null, artifactsHash?: string | null) {
    this.context = context;
    this.statePath = getApprovalStatePath(context.projectRoot);
    this.state = readApprovalState(context.projectRoot) ?? createDefaultApprovalState(context.projectRoot);
    // Merge in any passed-in hashes
    if (planHash) this.state.planHash = planHash;
    if (artifactsHash) this.state.artifactsHash = artifactsHash;
  }

  /** Whether the current workflow requires plan approval before writes. */
  requiresApproval(): boolean {
    if (this.context.workflow !== "plan_approve_build") {
      return false;
    }

    // If state says approved, verify hashes haven't changed
    if (this.state.status === "approved") {
      if (this.state.planHash) {
        const currentHash = computePlanHash(this.context.projectRoot);
        if (currentHash !== null && currentHash !== this.state.planHash) {
          this.invalidateApproval();
          return true;
        }
      }
      if (this.state.artifactsHash) {
        const currentHash = computeArtifactsHash(this.context.projectRoot);
        if (currentHash !== null && currentHash !== this.state.artifactsHash) {
          this.invalidateApproval();
          return true;
        }
      }
      return false; // approved and hashes match
    }

    // Not approved, approval required
    return true;
  }

  /** Whether the plan is currently approved. */
  isApproved(): boolean {
    return this.state.status === "approved";
  }

  /** The plan revision this approval is tied to. */
  approvedPlanRevision(): number | undefined {
    return this.state.planRevision;
  }

  /**
   * Evaluate a tool call. Returns a decision that the canUseTool hook should
   * honor. Write tools are blocked when approval is required and not granted.
   */
  evaluateToolCall(
    toolName: string,
    input: Record<string, unknown>
  ): ToolDecision {
    const target = getPathFromInput(input);

    // Always block internal state files (regardless of phase or approval)
    if (target) {
      const normalized = target.replace(/\\/g, "/");
      for (const pattern of INTERNAL_STATE_PATTERNS) {
        if (normalized.includes(pattern)) {
          return {
            behavior: "deny",
            message: `Direct editing of internal workflow state ('${pattern}') is not allowed. Reason: PROTECTED_PATH. Remediation: Use the workflow controller to modify these files.`,
            reasonCode: "PROTECTED_PATH",
            retryable: false,
          } as any;
        }
      }
    }

    // Allow planning artifacts during planning phase (before approval)
    if (target && this.context.phase === "planning") {
      const normalized = target.replace(/\\/g, "/");
      const fileName = normalized.split("/").pop() || "";
      if (PLANNING_ARTIFACTS.includes(fileName)) {
        return { behavior: "allow" };
      }
    }

    // Non-write tools are always allowed
    if (!WRITE_TOOLS.has(toolName)) {
      return { behavior: "allow" };
    }

    // Check approval for project files
    if (!this.requiresApproval()) {
      return { behavior: "allow" };
    }

    this.pendingApproval = true;

    return {
      behavior: "deny",
      message:
        `Plan approval required before using '${toolName}'. ` +
        `Reason: PLAN_NOT_APPROVED. Remediation: Review and approve the plan at .node-cli/project/plan.md, then re-run to authorize writes.`,
      reasonCode: "PLAN_NOT_APPROVED",
      retryable: false,
    } as any;
  }

  /** Mark that approval has been requested (pending user decision). */
  requestApproval(): void {
    this.pendingApproval = true;
    this.state.status = "pending";
    writeApprovalState(this.state, this.context.projectRoot);
  }

  /** Grant approval for the current plan revision. */
  grantApproval(planRevision: number): void {
    this.state.status = "approved";
    this.state.planRevision = planRevision;
    this.state.approvedAt = new Date().toISOString();
    this.state.planHash = computePlanHash(this.context.projectRoot);
    this.state.artifactsHash = computeArtifactsHash(this.context.projectRoot);
    this.pendingApproval = false;
    writeApprovalState(this.state, this.context.projectRoot);
  }

  /** Invalidate approval (e.g. after a material plan revision). */
  invalidateApproval(): void {
    this.state.status = "invalidated";
    this.state.approvedAt = null;
    this.state.planRevision += 1;
    this.pendingApproval = false;
    writeApprovalState(this.state, this.context.projectRoot);
  }

  /** Whether there is a pending approval awaiting user decision. */
  hasPendingApproval(): boolean {
    return this.pendingApproval;
  }

  /** Get the workflow id. */
  getWorkflow(): WorkflowId {
    return this.context.workflow;
  }
}

/**
 * Convenience: evaluate a tool call against the active approval gate.
 * Returns null if no gate is active (no restrictions beyond existing policy).
 */
export function evaluateWithApprovalGate(
  toolName: string,
  input: Record<string, unknown>
): ToolDecision | null {
  const gate = getActiveApprovalGate();
  if (!gate) return null;
  return gate.evaluateToolCall(toolName, input);
}