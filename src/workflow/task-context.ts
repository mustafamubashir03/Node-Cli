import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, getNodeCliHome } from "../memory/memory.js";
import type {
  TaskContext,
  WorkflowId,
  WorkflowPhase,
  ApprovalStatus,
} from "./types.js";
export type { TaskContext };

const TASK_CONTEXT_FILE = "task-context.json";

/**
 * Location of the persisted task context for a session within a project.
 * Stored under the project's `.node-cli` directory so it survives across
 * turns and short follow-up messages within the same active task.
 */
export function getTaskContextDir(
  sessionId: string,
  projectRoot?: string
): string {
  const root = projectRoot ?? findProjectRoot();
  return join(root, ".node-cli", "sessions", sessionId);
}

export function getTaskContextPath(
  sessionId: string,
  projectRoot?: string
): string {
  return join(getTaskContextDir(sessionId, projectRoot), TASK_CONTEXT_FILE);
}

export function loadTaskContext(
  sessionId: string,
  projectRoot?: string
): TaskContext | null {
  const path = getTaskContextPath(sessionId, projectRoot);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as TaskContext;
  } catch {
    return null;
  }
}

export function saveTaskContext(
  context: TaskContext,
  projectRoot?: string
): void {
  const sessionDir = getTaskContextDir(context.taskId, projectRoot);
  mkdirSync(sessionDir, { recursive: true });
  const path = join(sessionDir, TASK_CONTEXT_FILE);
  context.updatedAt = new Date().toISOString();
  writeFileSync(path, JSON.stringify(context, null, 2), "utf8");
}

export function createTaskContext({
  taskId,
  originalTask,
  projectRoot,
  workflow = "quick",
}: {
  taskId: string;
  originalTask: string;
  projectRoot: string;
  workflow?: WorkflowId;
}): TaskContext {
  const now = new Date().toISOString();
  return {
    taskId,
    originalTask,
    projectRoot,
    workflow,
    phase: "discovery",
    requirements: [],
    openQuestions: [],
    decisions: [],
    planRevision: 0,
    approvalStatus: "none",
    milestones: [],
    pendingActions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function isWorkflowActive(context: TaskContext): boolean {
  return context.workflow !== "quick" || context.phase !== "discovery";
}

export function requiresApproval(context: TaskContext): boolean {
  return (
    context.workflow === "plan_approve_build" &&
    context.approvalStatus !== "approved"
  );
}

export function isPlanApproved(context: TaskContext): boolean {
  return context.approvalStatus === "approved";
}

/** List all session IDs for a project. */
export function listSessionIds(projectRoot?: string): string[] {
  const root = projectRoot ?? findProjectRoot();
  const sessionsDir = join(root, ".node-cli", "sessions");
  if (!existsSync(sessionsDir)) return [];
  try {
    return readdirSync(sessionsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** Find unfinished sessions for a project. */
export function findUnfinishedSessions(projectRoot?: string): TaskContext[] {
  const ids = listSessionIds(projectRoot);
  const unfinished: TaskContext[] = [];
  for (const id of ids) {
    const ctx = loadTaskContext(id, projectRoot);
    if (ctx && ctx.phase !== "complete" && ctx.phase !== "blocked") {
      unfinished.push(ctx);
    }
  }
  return unfinished;
}
