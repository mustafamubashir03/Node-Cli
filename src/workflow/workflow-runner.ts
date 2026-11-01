import { input } from "@inquirer/prompts";
import { findProjectRoot } from "../memory/memory.js";
import {
  createTaskContext,
  loadTaskContext,
  saveTaskContext,
  isWorkflowActive,
  type TaskContext,
} from "./task-context.js";
import { buildSkillManifest, manifestSummary, updateManifestLifecycle, type SkillManifest } from "./skill-manifest.js";
import { loadSkillBody } from "../skills/loader.js";
import { runVerification } from "./verification.js";
import {
  ensureProjectArtifactDir,
  writeArtifact,
  getProjectArtifactPaths,
  readArtifact,
  parseMilestonesFromPlan,
} from "./plan-artifacts.js";
import { detectGreenfield, type GreenfieldResult } from "./greenfield-detector.js";
import {
  ApprovalGate,
  setActiveApprovalGate,
  clearActiveApprovalGate,
  getActiveApprovalGate,
  evaluateWithApprovalGate,
  computePlanHash,
  computeArtifactsHash,
} from "./approval-gate.js";
import { availableEnabledSkills } from "../skills/registry.js";
import type { Mode } from "../agent/modes.js";
import type { OpenQuestion, Milestone, SkillManifestEntry, Decision } from "./types.js";
import {
  printNotice,
  printSuccess,
  printWarning,
} from "../ui/messages.js";

export type WorkflowRunnerOptions = {
  sessionId: string;
  mode: Mode;
  projectRoot?: string;
  verbose?: boolean;
  enabledSkills?: string[];
};

export class WorkflowRunner {
  private sessionId: string;
  private mode: Mode;
  private projectRoot: string;
  private verbose: boolean;
  private enabledSkills: string[];
  private context: TaskContext | null = null;
  private manifest: SkillManifest | null = null;

  constructor(options: WorkflowRunnerOptions) {
    this.sessionId = options.sessionId;
    this.mode = options.mode;
    this.projectRoot = options.projectRoot ?? findProjectRoot();
    this.verbose = options.verbose ?? false;
    this.enabledSkills = options.enabledSkills ?? [];
  }

  getContext(): TaskContext | null {
    return this.context;
  }

  /**
   * Resume an unfinished session from persisted state.
   * Validates the plan hash and sets up the approval gate if approved.
   * Returns true if resumption succeeded, false if state is invalid/corrupt.
   */
  async resumeSession(sessionId: string): Promise<{
    success: boolean;
    message: string;
    context?: TaskContext;
  }> {
    const ctx = loadTaskContext(sessionId, this.projectRoot);
    if (!ctx) {
      return { success: false, message: `No persisted state found for session ${sessionId}.` };
    }

    // Validate plan integrity if approved
    if (ctx.approvalStatus === "approved") {
      const currentPlanHash = computePlanHash(this.projectRoot);
      const currentArtifactsHash = computeArtifactsHash(this.projectRoot);

      // Compare against stored hashes
      if (ctx.approvedPlanHash && currentPlanHash !== ctx.approvedPlanHash) {
        ctx.approvalStatus = "invalidated";
        ctx.approvedPlanRevision = undefined;
        ctx.approvedPlanHash = null;
        ctx.approvedArtifactsHash = null;
      } else if (ctx.approvedArtifactsHash && currentArtifactsHash !== ctx.approvedArtifactsHash) {
        ctx.approvalStatus = "invalidated";
        ctx.approvedPlanRevision = undefined;
        ctx.approvedPlanHash = null;
        ctx.approvedArtifactsHash = null;
      } else if (currentPlanHash === null) {
        // Plan file missing
        ctx.approvalStatus = "invalidated";
        ctx.approvedPlanRevision = undefined;
        ctx.approvedPlanHash = null;
        ctx.approvedArtifactsHash = null;
      }
    }

    // Restore context
    this.context = ctx;
    this.sessionId = sessionId;
    await this.saveContext();

    // Set up approval gate if approved
    if (ctx.approvalStatus === "approved") {
      // Use stored hashes from context, not freshly computed ones
      setActiveApprovalGate(new ApprovalGate(ctx, ctx.approvedPlanHash, ctx.approvedArtifactsHash));
    } else {
      clearActiveApprovalGate();
      if (ctx.workflow === "plan_approve_build") {
        setActiveApprovalGate(new ApprovalGate(ctx));
      }
    }

    // Rebuild skill manifest from artifacts if needed
    const skillPlanContent = readArtifact("skillPlan", this.projectRoot);
    if (skillPlanContent && !this.manifest) {
      // Manifest will be rebuilt on next planning phase
    }

    const phase = ctx.phase;
    const approved = ctx.approvalStatus === "approved";
    return {
      success: true,
      message: `Resumed session ${sessionId}: phase=${phase}, approved=${approved}, planRevision=${ctx.planRevision}`,
      context: ctx,
    };
  }

  getManifest(): SkillManifest | null {
    return this.manifest;
  }

  getApprovalGate(): ApprovalGate | null {
    return getActiveApprovalGate();
  }

  async processUserMessage(userInput: string): Promise<{
    action:
      | "proceed"
      | "ask_workflow"
      | "ask_approval"
      | "ask_clarification"
      | "plan_created"
      | "plan_approved"
      | "plan_revised"
      | "error";
    message?: string;
    context?: TaskContext;
    manifest?: SkillManifest;
  }> {
    const trimmed = userInput.trim();
    const lower = trimmed.toLowerCase();

    let ctx: TaskContext;
    const existing = loadTaskContext(this.sessionId, this.projectRoot);
    if (existing) {
      ctx = existing;
      this.context = ctx;
    } else {
      ctx = createTaskContext({
        taskId: this.sessionId,
        originalTask: userInput,
        projectRoot: this.projectRoot,
        workflow: "quick",
      });
      this.context = ctx;
      await this.saveContext();
    }

    // Handle pending workflow choice (user replied 1/2/3)
    if (ctx.pendingActions.includes("workflow_choice")) {
      const choice = this.parseWorkflowChoice(lower);
      if (choice) {
        ctx.pendingActions = ctx.pendingActions.filter(
          (a: string) => a !== "workflow_choice"
        );
        this.context = ctx;
        await this.saveContext();
        return this.setWorkflow(choice);
      }
      return {
        action: "ask_workflow",
        message: "Please reply with 1, 2, or 3 to choose a workflow.",
        context: ctx,
      };
    }

    // Handle approval / revision when plan is pending
    if (
      ctx.workflow === "plan_approve_build" &&
      ctx.approvalStatus !== "approved"
    ) {
      if (lower === "approve" || lower === "approved" || lower === "authorize" || lower === "authorized" || lower === "yes" || lower === "ok") {
        return this.approvePlan();
      }
      if (lower === "revise" || lower === "revision") {
        return this.requestRevision();
      }
    }

    // Handle delegated decisions ("choose for me", "use your judgment")
    if (
      lower.includes("choose for me") ||
      lower.includes("use your judgment") ||
      lower.includes("decide for me") ||
      lower.includes("you decide")
    ) {
      ctx.decisions.push({
        id: `delegated-${ctx.decisions.length + 1}`,
        decision: `Delegated: ${userInput.trim()}`,
        rationale: "User delegated this decision to the agent",
        madeAt: new Date().toISOString(),
      });
      this.context = ctx;
      await this.saveContext();
      printNotice("[DECISION] Recorded delegated decision. The agent will make a reasoned choice.");
    }

    // Check if this is a follow-up to an active task
    const isFollowUp = this.isFollowUp(userInput) && ctx.workflow !== "quick";
    if (isFollowUp) {
      // Interpret as follow-up: update decisions/artifacts, don't restart workflow
      printNotice("[FOLLOW-UP] Interpreting as follow-up to active task. Active workflow preserved.");
    }

    // For follow-ups, skip greenfield detection entirely
    if (isFollowUp) {
      return { action: "proceed", context: ctx };
    }

    // No active workflow yet: detect greenfield + build intent
    if (!isWorkflowActive(ctx) && ctx.workflow === "quick") {
      const detection = detectGreenfield(this.projectRoot, userInput);
      if (detection.isGreenfield && detection.confidence !== "low") {
        const workflow: "plan_approve_build" | "quick" =
          detection.confidence === "high"
            ? "plan_approve_build"
            : "quick";

        ctx.pendingActions = ["workflow_choice"];
        ctx.originalTask = userInput;
        this.context = ctx;
        await this.saveContext();

        return {
          action: "ask_workflow",
          message: this.buildWorkflowPrompt(userInput, detection, workflow),
          context: ctx,
        };
      }

      ctx.workflow = "quick";
      ctx.phase = "implementation";
      this.context = ctx;
      await this.saveContext();
      return { action: "proceed", context: ctx };
    }

    return { action: "proceed", context: ctx };
  }

  private parseWorkflowChoice(input: string): "quick" | "clarify_then_build" | "plan_approve_build" | null {
    if (input === "1" || input.includes("plan first")) return "plan_approve_build";
    if (input === "2" || input.includes("questions") || input.includes("clarify")) return "clarify_then_build";
    if (input === "3" || input.includes("build now") || input.includes("defaults")) return "quick";
    return null;
  }

  async setWorkflow(workflow: "quick" | "clarify_then_build" | "plan_approve_build"): Promise<{
    action: "proceed" | "ask_clarification" | "plan_created";
    message?: string;
    context?: TaskContext;
    manifest?: SkillManifest;
  }> {
    if (!this.context) {
      return { action: "proceed", context: undefined };
    }

    this.context.workflow = workflow;
    this.context.phase = "discovery";
    await this.saveContext();

    if (workflow === "quick") {
      this.context!.phase = "implementation";
      await this.saveContext();
      return { action: "proceed", context: this.context ?? undefined };
    }

    if (workflow === "clarify_then_build") {
      const questions = this.deriveClarificationQuestions();
      if (questions.length > 0) {
        this.context!.openQuestions = questions;
        this.context!.phase = "clarification";
        await this.saveContext();
        return {
          action: "ask_clarification",
          message: this.formatClarificationPrompt(questions),
          context: this.context ?? undefined,
        };
      }
      this.context!.phase = "implementation";
      await this.saveContext();
      return { action: "proceed", context: this.context ?? undefined };
    }

    await this.createPlanningArtifacts();
    this.context!.phase = "planning";
    await this.saveContext();

    return {
      action: "plan_created",
      message: `Plan artifacts created at ${getProjectArtifactPaths(this.projectRoot).plan}. Review the plan and skill manifest, then approve to authorize writes.`,
      context: this.context ?? undefined,
      manifest: this.manifest ?? undefined,
    };
  }

  async answerClarification(questionId: string, answer: string): Promise<{
    action: "proceed" | "ask_clarification" | "plan_created";
    message?: string;
    context?: TaskContext;
    manifest?: SkillManifest;
  }> {
    if (!this.context) return { action: "proceed", context: undefined };

    const ctx = this.context;
    const q = ctx.openQuestions.find((q: OpenQuestion) => q.id === questionId);
    if (q) {
      q.answer = answer;
      q.answeredAt = new Date().toISOString();
    }

    const unanswered = ctx.openQuestions.filter((q: OpenQuestion) => !q.answer);
    if (unanswered.length > 0) {
      return {
        action: "ask_clarification",
        message: this.formatClarificationPrompt(unanswered),
        context: ctx,
      };
    }

    ctx.phase = "planning";
    ctx.requirements.push(
      ...ctx.openQuestions.map((q: OpenQuestion) => `Q: ${q.question} → A: ${q.answer}`)
    );
    await this.saveContext();

    await this.createPlanningArtifacts();
    return {
      action: "plan_created",
      message: "Clarification complete. Plan artifacts created. Review and approve to authorize writes.",
      context: ctx,
      manifest: this.manifest ?? undefined,
    };
  }

  async approvePlan(): Promise<{
    action: "proceed" | "error";
    message?: string;
    context?: TaskContext;
  }> {
    if (!this.context || !this.manifest) {
      return { action: "error", message: "No plan or manifest to approve." };
    }

    const ctx = this.context;
    const manifest = this.manifest;
    ctx.approvalStatus = "approved";
    ctx.approvedPlanRevision = ctx.planRevision;
    ctx.phase = "implementation";
    const planHash = computePlanHash(this.projectRoot);
    const artifactsHash = computeArtifactsHash(this.projectRoot);
    ctx.approvedPlanHash = planHash;
    ctx.approvedArtifactsHash = artifactsHash;
    this.context = ctx;
    await this.saveContext();

    this.manifest = approveManifestSkill(manifest, ctx.planRevision);
    await this.saveManifest();

    setActiveApprovalGate(new ApprovalGate(ctx, planHash, artifactsHash));
    printSuccess("Plan approved. Write tools are now authorized.");

    return { action: "proceed", message: "Plan approved. Implementation can begin.", context: ctx };
  }

  async requestRevision(): Promise<{
    action: "plan_revised";
    message: string;
    context?: TaskContext;
  }> {
    if (!this.context) {
      return { action: "plan_revised", message: "No active context.", context: undefined };
    }

    const ctx = this.context;
    ctx.planRevision += 1;
    ctx.approvalStatus = "invalidated";
    ctx.approvedPlanRevision = undefined;
    ctx.phase = "planning";
    this.context = ctx;
    await this.saveContext();

    if (this.manifest) {
      invalidateManifestApprovalSkill(this.manifest);
      await this.saveManifest();
    }

    clearActiveApprovalGate();
    printWarning(`Plan revised (revision ${ctx.planRevision}). Approval invalidated. Re-approve before writing.`);

    return {
      action: "plan_revised",
      message: `Plan revised to revision ${ctx.planRevision}. Approval invalidated. Re-approve before writes.`,
      context: ctx,
    };
  }

  async startMilestone(milestoneId: string): Promise<void> {
    if (!this.context) return;
    const ctx = this.context;
    const m = ctx.milestones.find((m: Milestone) => m.id === milestoneId);
    if (m) {
      m.status = "in_progress";
      m.startedAt = new Date().toISOString();
      ctx.currentMilestoneId = milestoneId;
      this.context = ctx;
      await this.saveContext();
    }
  }

  async completeMilestone(milestoneId: string, evidence?: string[]): Promise<void> {
    if (!this.context) return;
    const ctx = this.context;
    const m = ctx.milestones.find((m: Milestone) => m.id === milestoneId);
    if (m) {
      m.status = "completed";
      m.completedAt = new Date().toISOString();
      if (evidence) m.evidence = evidence;
      this.context = ctx;
      await this.saveContext();
    }
  }

  /** Check if a milestone can be started (dependencies met). */
  canStartMilestone(milestoneId: string): { canStart: boolean; reason?: string } {
    if (!this.context) return { canStart: false, reason: "No active context" };
    const m = this.context.milestones.find((m: Milestone) => m.id === milestoneId);
    if (!m) return { canStart: false, reason: `Milestone ${milestoneId} not found` };
    if (m.status === "completed") return { canStart: false, reason: "Already completed" };
    if (m.status === "in_progress") return { canStart: false, reason: "Already in progress" };

    // Check dependencies
    for (const depId of m.dependencies) {
      const dep = this.context.milestones.find((d: Milestone) => d.id === depId);
      if (!dep) return { canStart: false, reason: `Dependency ${depId} not found` };
      if (dep.status !== "completed") {
        return { canStart: false, reason: `Dependency ${depId} not completed (status: ${dep.status})` };
      }
    }

    return { canStart: true };
  }

  /** Start a milestone with checkpoint. */
  async startMilestoneWithCheckpoint(milestoneId: string): Promise<{ success: boolean; reason?: string }> {
    const check = this.canStartMilestone(milestoneId);
    if (!check.canStart) return { success: false, reason: check.reason };

    if (!this.context) return { success: false, reason: "No active context" };
    const ctx = this.context;
    const m = ctx.milestones.find((m: Milestone) => m.id === milestoneId);
    if (!m) return { success: false, reason: "Milestone not found" };

    m.status = "in_progress";
    m.startedAt = new Date().toISOString();
    ctx.currentMilestoneId = milestoneId;
    this.context = ctx;
    await this.saveContext(); // checkpoint

    printNotice(`[MILESTONE] Started: ${milestoneId} - ${m.objective}`);
    return { success: true };
  }

  /** Mark a milestone as failed with error. */
  async failMilestone(milestoneId: string, error: string): Promise<void> {
    if (!this.context) return;
    const ctx = this.context;
    const m = ctx.milestones.find((m: Milestone) => m.id === milestoneId);
    if (m) {
      m.status = "failed";
      m.evidence = m.evidence || [];
      m.evidence.push(`FAILED: ${error} (${new Date().toISOString()})`);
      this.context = ctx;
      await this.saveContext();
      printNotice(`[MILESTONE] Failed: ${milestoneId} - ${error}`);
    }
  }

  /** Retry a failed milestone. */
  async retryMilestone(milestoneId: string): Promise<{ success: boolean; reason?: string }> {
    if (!this.context) return { success: false, reason: "No active context" };
    const ctx = this.context;
    const m = ctx.milestones.find((m: Milestone) => m.id === milestoneId);
    if (!m) return { success: false, reason: "Milestone not found" };
    if (m.status !== "failed") return { success: false, reason: `Cannot retry (status: ${m.status})` };

    m.status = "not_started";
    m.startedAt = undefined;
    m.completedAt = undefined;
    this.context = ctx;
    await this.saveContext();

    return this.startMilestoneWithCheckpoint(milestoneId);
  }

  /** Get the next ready milestone (dependencies met, not started). */
  getNextReadyMilestone(): Milestone | null {
    if (!this.context) return null;
    for (const m of this.context.milestones) {
      if (m.status === "not_started") {
        const check = this.canStartMilestone(m.id);
        if (check.canStart) return m;
      }
    }
    return null;
  }

  /** Check if all milestones are completed. */
  areAllMilestonesComplete(): boolean {
    if (!this.context) return false;
    return this.context.milestones.length > 0 &&
      this.context.milestones.every((m) => m.status === "completed");
  }

  /** Verify a milestone by running project-appropriate checks. */
  async verifyMilestone(milestoneId: string): Promise<{ passed: boolean; checks: any[] }> {
    if (!this.context) return { passed: false, checks: [] };
    const result = runVerification(this.projectRoot);
    const passed = result.overall === "passed";
    printNotice(`[VERIFY] ${milestoneId}: ${result.overall} (${result.checks.length} checks)`);
    return { passed, checks: result.checks };
  }

  /** Complete a milestone only after verification passes. */
  async completeMilestoneWithVerification(milestoneId: string, evidence?: string[]): Promise<{ success: boolean; reason?: string }> {
    const verifyResult = await this.verifyMilestone(milestoneId);
    if (!verifyResult.passed) {
      await this.failMilestone(milestoneId, "Verification failed");
      return { success: false, reason: "Verification failed" };
    }

    await this.completeMilestone(milestoneId, evidence);
    printNotice(`[MILESTONE] Completed: ${milestoneId} (verified)`);
    return { success: true };
  }

  /** Get milestone execution summary. */
  getMilestoneSummary(): string {
    if (!this.context) return "No active context";
    const ms = this.context.milestones;
    if (ms.length === 0) return "No milestones defined";
    const completed = ms.filter((m) => m.status === "completed").length;
    const inProgress = ms.filter((m) => m.status === "in_progress").length;
    const failed = ms.filter((m) => m.status === "failed").length;
    const pending = ms.filter((m) => m.status === "not_started").length;
    return `Milestones: ${completed}/${ms.length} completed, ${inProgress} in progress, ${failed} failed, ${pending} pending`;
  }

  /**
   * Sync milestones from plan.md into the task context.
   * Parses the plan file and updates milestone status.
   */
  async syncMilestonesFromPlan(): Promise<void> {
    if (!this.context) return;
    const planContent = readArtifact("plan", this.projectRoot);
    if (!planContent) return;

    const parsed = parseMilestonesFromPlan(planContent);
    const ctx = this.context;
    for (const p of parsed) {
      const existing = ctx.milestones.find((m: Milestone) => m.id === p.id);
      if (!existing) {
        ctx.milestones.push({
          id: p.id,
          objective: p.objective,
          files: [],
          dependencies: [],
          completionCriteria: [],
          verificationSteps: [],
          status: p.status === "completed" ? "completed" : "not_started",
        });
      } else {
        if (p.status === "completed" && existing.status !== "completed") {
          existing.status = "completed";
          existing.completedAt = existing.completedAt ?? new Date().toISOString();
        }
      }
    }
    this.context = ctx;
    await this.saveContext();
  }

  private async saveContext(): Promise<void> {
    if (this.context) {
      saveTaskContext(this.context, this.projectRoot);
    }
  }

  private async saveManifest(): Promise<void> {
    if (this.manifest) {
      writeArtifact("skillPlan", manifestToMarkdown(this.manifest), this.projectRoot);
    }
  }

  private async createPlanningArtifacts(): Promise<void> {
    if (!this.context) return;
    const ctx = this.context;

    ensureProjectArtifactDir(this.projectRoot);

    const enabled = availableEnabledSkills(this.enabledSkills);
    this.manifest = buildSkillManifest({
      taskId: this.sessionId,
      task: ctx.originalTask,
      enabledSkills: enabled,
      mode: this.mode,
      planRevision: ctx.planRevision,
    });

    const brief = this.buildBrief();
    writeArtifact("brief", brief, this.projectRoot);

    const decisions = this.buildDecisions();
    writeArtifact("decisions", decisions, this.projectRoot);

    writeArtifact("skillPlan", manifestToMarkdown(this.manifest!), this.projectRoot);

    const plan = this.buildPlan();
    writeArtifact("plan", plan, this.projectRoot);

    // Sync milestones from the newly created plan
    await this.syncMilestonesFromPlan();

    setActiveApprovalGate(new ApprovalGate(ctx));
  }

  private buildBrief(): string {
    const c = this.context!;
    const lines = [
      "# Project Brief",
      "",
      "## Objective",
      c.originalTask,
      "",
      "## Project Root",
      c.projectRoot,
      "",
      "## Workflow",
      c.workflow,
      "",
      "## Requirements",
      ...c.requirements.map((r: string) => `- ${r}`),
      "",
      "## Open Questions",
      ...c.openQuestions.map((q: OpenQuestion) => `- [ ] ${q.question}`),
      "",
      "## Decisions",
      ...c.decisions.map((d: Decision) => `- ${d.decision} (${d.madeAt})`),
      "",
      "## Assumptions",
      `- Workflow: ${c.workflow}`,
      `- Mode: ${this.mode}`,
      "",
      "## Acceptance Criteria",
      "- Plan approved before any project write",
      "- Skill manifest aligned with task requirements",
      "- Milestones completed with verification evidence",
    ];
    return lines.join("\n");
  }

  private buildDecisions(): string {
    const c = this.context!;
    const lines = [
      "# Decisions",
      "",
      `## Workflow: ${c.workflow}`,
      "",
      "## Skill Manifest",
      this.manifest ? manifestSummary(this.manifest) : "Not yet built",
      "",
      `## Plan Revision: ${c.planRevision}`,
      "",
      `## Approval Status: ${c.approvalStatus}`,
    ];
    return lines.join("\n");
  }

  private buildPlan(): string {
    const c = this.context!;
    const lines = [
      "# Implementation Plan",
      "",
      "## Goal",
      c.originalTask,
      "",
      "## Workflow",
      c.workflow,
      "",
      "## Plan Revision",
      String(c.planRevision),
      "",
      "## Approval Status",
      c.approvalStatus,
      "",
      "## Milestones",
    ];
    if (c.milestones.length === 0) {
      // Generate default milestones based on task type
      const task = c.originalTask.toLowerCase();
      const isWeb = /website|site|page|landing|html|css|frontend|ui/i.test(task);
      const isFigma = /figma/i.test(task);
      if (isFigma) {
        lines.push("- [ ] M1: Retrieve and analyze Figma design (structure, tokens, assets)");
        lines.push("- [ ] M2: Set up project structure and design tokens");
        lines.push("- [ ] M3: Implement layout and visual design from Figma spec");
        lines.push("- [ ] M4: Implement components, interactions, and responsive behavior");
        lines.push("- [ ] M5: Visual QA and refinement against Figma reference");
      } else if (isWeb) {
        lines.push("- [ ] M1: Establish project structure (HTML/CSS/JS files)");
        lines.push("- [ ] M2: Implement responsive layout and visual design");
        lines.push("- [ ] M3: Implement navigation, interactions, and functionality");
        lines.push("- [ ] M4: Responsive, accessibility, and functional verification");
      } else {
        lines.push("- [ ] M1: Project setup and structure");
        lines.push("- [ ] M2: Core implementation");
        lines.push("- [ ] M3: Testing and verification");
      }
    } else {
      for (const m of c.milestones) {
        lines.push(`- [ ] ${m.id}: ${m.objective}`);
        for (const crit of m.completionCriteria) lines.push(`  - Criterion: ${crit}`);
      }
    }
    lines.push(
      "",
      "## Skill Plan",
      this.manifest ? manifestSummary(this.manifest) : "Not yet built",
      "",
      "## Verification",
      "- Run pnpm test",
      "- Run pnpm run typecheck",
      "- Verify milestones complete",
    );
    return lines.join("\n");
  }

  private buildWorkflowPrompt(
    userInput: string,
    detection: GreenfieldResult,
    recommended: "plan_approve_build" | "quick"
  ): string {
    const lines = [
      "",
      "🏗️  Greenfield build detected.",
      `   ${detection.reasons.join("; ")}`,
      "",
      "How would you like to proceed?",
      "",
      "  1. Plan first (recommended) — create a plan and skill manifest, approve before writing any files.",
      "  2. Answer a few questions, then build — clarify requirements, then implement.",
      "  3. Build now using sensible defaults — proceed immediately.",
      "",
      `   Recommended: ${recommended === "plan_approve_build" ? "1 (Plan first)" : "3 (Build now)"}`,
      "",
      "Reply with 1, 2, or 3.",
    ];
    return lines.join("\n");
  }

  private deriveClarificationQuestions(): { id: string; question: string }[] {
    const c = this.context!;
    const task = c.originalTask.toLowerCase();
    const questions: { id: string; question: string }[] = [];

    // Detect project type from task keywords
    const isWeb = /\b(website|site|page|landing|html|css|frontend|ui|web app)\b/i.test(task);
    const isBackend = /\b(api|backend|server|database|service|endpoint)\b/i.test(task);
    const isCli = /\b(cli|command.line|terminal)\b/i.test(task);
    const isFigma = /\b(figma|figma.com|figma design|figma url|figma frame|figma file|design-to-code)\b/i.test(task);

    if (isWeb) {
      if (!task.includes("color") && !task.includes("palette") && !task.includes("theme")) {
        questions.push({
          id: "palette",
          question: "What color palette, theme, or brand style should the site use? (Or reply 'choose for me')",
        });
      }
      if (!task.includes("page") && !task.includes("section") && !task.includes("screen")) {
        questions.push({
          id: "pages",
          question: "Which pages or sections should the site include? (e.g., home, about, contact, menu)",
        });
      }
      if (!task.includes("image") && !task.includes("photo") && !task.includes("picture")) {
        questions.push({
          id: "images",
          question: "Should I include real images? If so, what subjects? (Or reply 'no images')",
        });
      }
      if (!task.includes("user") && !task.includes("audience") && !task.includes("customer")) {
        questions.push({
          id: "audience",
          question: "Who is the target audience or primary user? (Or reply 'general')",
        });
      }
    } else if (isBackend) {
      if (!task.includes("database") && !task.includes("storage") && !task.includes("persist")) {
        questions.push({
          id: "storage",
          question: "What data storage is needed? (e.g., PostgreSQL, SQLite, in-memory, or none)",
        });
      }
      if (!task.includes("auth") && !task.includes("login") && !task.includes("permission")) {
        questions.push({
          id: "auth",
          question: "Is authentication or authorization required? (Or reply 'none')",
        });
      }
      if (!task.includes("test") && !task.includes("testing")) {
        questions.push({
          id: "testing",
          question: "What testing approach? (e.g., unit tests, integration tests, or 'standard')",
        });
      }
    } else if (isCli) {
      if (!task.includes("command") && !task.includes("subcommand")) {
        questions.push({
          id: "commands",
          question: "What commands or subcommands should the CLI support?",
        });
      }
    } else if (isFigma) {
      if (!task.includes("responsive") && !task.includes("mobile")) {
        questions.push({
          id: "responsive",
          question: "Should I implement responsive behavior for mobile? (Or reply 'desktop only')",
        });
      }
      if (!task.includes("framework") && !task.includes("react") && !task.includes("vue")) {
        questions.push({
          id: "framework",
          question: "What framework should I use? (e.g., React, Vue, vanilla HTML/CSS/JS, or 'existing project')",
        });
      }
    } else {
      // Generic project questions
      if (!task.includes("test")) {
        questions.push({
          id: "testing",
          question: "What verification or testing approach should be used?",
        });
      }
    }

    // Limit to 3 questions max
    return questions.slice(0, 3);
  }

  private formatClarificationPrompt(questions: { id: string; question: string }[]): string {
    const lines = [
      "",
      "❓  A few quick questions before building:",
      "",
    ];
    for (const q of questions) {
      lines.push(`  ${q.id}. ${q.question}`);
    }
    lines.push("", "Reply with the question number and your answer, e.g. '1. dark mode, gold accents'.");
    return lines.join("\n");
  }

  updateSkillLifecycle(skillId: string, state: "loaded" | "requested" | "applied"): void {
    if (!this.manifest) return;
    updateManifestLifecycle(this.manifest, skillId, state);
    this.saveManifest();
  }

  /**
   * Build skill context for the model request.
   * Loads selected skill bodies and returns them as context text.
   * Tracks which skills were loaded in the manifest.
   */
  buildSkillContextForTurn(): string | null {
    if (!this.manifest || !this.manifest.approved) return null;

    const parts: string[] = [];
    for (const id of this.manifest.selected) {
      const body = loadSkillBody(id);
      if (body) {
        parts.push(`## Skill: ${id}\n\n${body.body}`);
        this.updateSkillLifecycle(id, "loaded");
      }
    }

    if (parts.length === 0) return null;
    return "[Approved Skill Context]\n\n" + parts.join("\n\n---\n\n");
  }

  /**
   * Determine if a message is a follow-up to the active task.
   */
  isFollowUp(userInput: string): boolean {
    if (!this.context) return false;
    // No active workflow means no follow-up
    if (this.context.workflow === "quick" && this.context.phase === "discovery") return false;
    // If we're awaiting clarification or approval, any message is likely a follow-up
    if (this.context.phase === "clarification" || this.context.phase === "approval_pending") return true;
    // If we're in implementation with an approved plan, short messages are likely follow-ups
    if (this.context.phase === "implementation" && this.context.approvalStatus === "approved") {
      const trimmed = userInput.trim();
      if (trimmed.length < 80) return true;
      const lower = trimmed.toLowerCase();
      if (lower.includes("choose") || lower.includes("palette") || lower.includes("approve") || lower.includes("revise") || lower.includes("use your judgment")) return true;
    }
    // If we're in planning phase, short messages are likely follow-ups
    if (this.context.phase === "planning") {
      const trimmed = userInput.trim();
      if (trimmed.length < 80) return true;
    }
    return false;
  }
}

/** Convert skill manifest to markdown for skill-plan.md artifact. */
function manifestToMarkdown(manifest: SkillManifest): string {
  const lines = [
    "# Skill Plan",
    "",
    `## Task: ${manifest.task}`,
    "",
    "## Budget",
    `- Used: ${manifest.budget.used} / ${manifest.budget.limit} tokens`,
    `- Over: ${manifest.budget.over}`,
    "",
    "## Approved",
    `- ${manifest.approved ? "Yes" : "No"}`,
    `- Plan revision: ${manifest.planRevision}`,
    `- Manifest revision: ${manifest.revision}`,
    "",
    `## Selected Skills (${manifest.selected.length})`,
  ];
  for (const id of manifest.selected) {
    const entry = manifest.candidates.find((c: SkillManifestEntry) => c.id === id);
    lines.push(
      `- ${id} — ${entry?.rationale ?? "selected by router"} ` +
        `(~${entry?.contextTokens ?? 0} tokens, phase: ${entry?.phase ?? "implementation"})`
    );
  }
  lines.push("", `## Rejected / Skipped (${manifest.rejected.length})`);
  for (const id of manifest.rejected) {
    const entry = manifest.candidates.find((c: SkillManifestEntry) => c.id === id);
    lines.push(`- ${id} — ${entry?.rejectionReason ?? "not selected"}`);
  }
  lines.push("", `## Unavailable (${manifest.unavailable.length})`);
  for (const id of manifest.unavailable) {
    const entry = manifest.candidates.find((c: SkillManifestEntry) => c.id === id);
    lines.push(`- ${id} — ${entry?.availabilityReason ?? "unavailable"}`);
  }
  lines.push("", "## Lifecycle States");
  lines.push("- candidate: considered during routing");
  lines.push("- selected: chosen for this task");
  lines.push("- loaded: skill body delivered to model context");
  lines.push("- requested: model explicitly asked for the skill");
  lines.push("- applied: observable evidence the skill guided the work");
  lines.push("- rejected: considered but not selected");
  return lines.join("\n");
}

function approveManifestSkill(manifest: SkillManifest, planRevision: number): SkillManifest {
  manifest.approved = true;
  manifest.approvedAt = new Date().toISOString();
  manifest.planRevision = planRevision;
  manifest.revision += 1;
  return manifest;
}

function invalidateManifestApprovalSkill(manifest: SkillManifest): SkillManifest {
  manifest.approved = false;
  manifest.approvedAt = undefined;
  manifest.revision += 1;
  return manifest;
}
