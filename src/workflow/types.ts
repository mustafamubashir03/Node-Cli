export type WorkflowId = "quick" | "clarify_then_build" | "plan_approve_build";

export type WorkflowPhase =
  | "discovery"
  | "clarification"
  | "planning"
  | "approval_pending"
  | "approved"
  | "implementation"
  | "verification"
  | "blocked"
  | "complete";

export type SkillLifecycleState =
  | "candidate"
  | "selected"
  | "loaded"
  | "requested"
  | "applied"
  | "rejected";

export type ApprovalStatus = "none" | "pending" | "approved" | "invalidated";

export interface SkillManifestEntry {
  /** Skill catalogue id. */
  id: string;
  /** Whether the skill can be activated in this build. Mirrors SkillAvailability. */
  availability: "available" | "unavailable" | "unverified" | "missing" | "unknown";
  /** Human-readable explanation when unavailable. */
  availabilityReason?: string;
  /** Whether the router selected this skill for the task. */
  selected: boolean;
  /** Why the skill was selected (concrete benefit). */
  rationale?: string;
  /** Why the skill was rejected or skipped. */
  rejectionReason?: string;
  /** Intended phase of use. */
  phase: "discovery" | "design" | "implementation" | "verification";
  /** Lifecycle state: candidate → selected → loaded → requested → applied. */
  lifecycle: SkillLifecycleState;
  /** Estimated context tokens for the skill body. */
  contextTokens: number;
  /** Whether the skill body was actually loaded into the model context. */
  loaded: boolean;
  /** Whether the model explicitly requested the skill via UseSkill. */
  requested: boolean;
  /** Observable evidence that the skill's guidance was followed. */
  applied: boolean;
}

export interface SkillManifest {
  taskId: string;
  task: string;
  /** All skills considered from the catalogue. */
  candidates: SkillManifestEntry[];
  /** Skill ids selected for this task. */
  selected: string[];
  /** Skill ids rejected or skipped, with reasons in their entries. */
  rejected: string[];
  /** Skill ids unavailable in this build. */
  unavailable: string[];
  /** Context-budget accounting. */
  budget: { used: number; limit: number; over: boolean };
  /** Whether the user has approved this manifest. */
  approved: boolean;
  /** ISO timestamp when approval was granted. */
  approvedAt?: string;
  /** Plan revision this manifest is tied to. */
  planRevision: number;
  /** Manifest revision counter, incremented on material changes. */
  revision: number;
}

export interface OpenQuestion {
  id: string;
  question: string;
  answer?: string;
  answeredAt?: string;
}

export interface Decision {
  id: string;
  decision: string;
  rationale?: string;
  madeAt: string;
}

export interface Milestone {
  id: string;
  objective: string;
  files: string[];
  dependencies: string[];
  completionCriteria: string[];
  verificationSteps: string[];
  status: "not_started" | "in_progress" | "completed" | "failed" | "blocked";
  evidence?: string[];
  startedAt?: string;
  completedAt?: string;
}

export interface TaskContext {
  taskId: string;
  originalTask: string;
  projectRoot: string;
  projectType?: string;
  workflow: WorkflowId;
  phase: WorkflowPhase;
  requirements: string[];
  openQuestions: OpenQuestion[];
  decisions: Decision[];
  skillManifest?: SkillManifest;
  planRevision: number;
  approvalStatus: ApprovalStatus;
  approvedPlanRevision?: number;
  approvedPlanHash?: string | null;
  approvedArtifactsHash?: string | null;
  milestones: Milestone[];
  currentMilestoneId?: string;
  pendingActions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowChoice {
  workflow: WorkflowId;
  reason: string;
  designDirections?: DesignDirection[];
}

export interface DesignDirection {
  id: string;
  name: string;
  description: string;
  palette?: string;
  typography?: string;
  layout?: string;
  character: string;
}

export interface WorkflowDecisionEvent {
  type:
    | "workflow_chosen"
    | "clarification_asked"
    | "clarification_answered"
    | "plan_created"
    | "plan_revised"
    | "approval_requested"
    | "approval_granted"
    | "approval_invalidated"
    | "skill_selected"
    | "skill_loaded"
    | "skill_requested"
    | "skill_applied"
    | "write_blocked"
    | "write_permitted"
    | "milestone_started"
    | "milestone_completed"
    | "milestone_failed"
    | "verification_run";
  taskId: string;
  timestamp: string;
  detail: Record<string, unknown>;
}
