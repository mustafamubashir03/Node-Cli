import { input } from "@inquirer/prompts";
import { toolSurface, type Mode } from "../agent/modes.js";
import { closeSession, createSession, type AgentSession } from "../agent/session.js";
import { runTurn } from "../agent/turn.js";
import { runSlashCommand } from "./slash-commands.js";
import { promptForCredentials } from "../config/setup.js";
import { requireCredentials } from "../config/env.js";
import { readAppConfig } from "../config/app-config.js";
import { availableEnabledSkills } from "../skills/registry.js";
import { describeRouting, formatSkillShortlist } from "../skills/router.js";
import { selectSkills, toRouterResult } from "../skills/selection.js";
import { printGoodbye, printHint, printNotice, printSessionHeader, printSuccess, printFailure } from "../ui/messages.js";
import { stopSpinner } from "../ui/spinner.js";
import { style } from "../ui/styles.js";
import { skillStatusLine } from "./skills.js";
import { WorkflowRunner } from "../workflow/workflow-runner.js";
import { findUnfinishedSessions } from "../workflow/task-context.js";


export type ChatOptions = {
    mode?: Mode;
    verbose?: boolean;
};

export async function startChat(options: ChatOptions = {}): Promise<void> {
    await promptForCredentials();
    requireCredentials();

    const { mode = "agent", verbose = false } = options;
    const configuredSkills = readAppConfig().skills ?? [];
    const enabledSkills = availableEnabledSkills(configuredSkills);
    const unavailable = configuredSkills.filter((id) => !enabledSkills.includes(id));
    const session = createSession(mode, enabledSkills);

    const runner = new WorkflowRunner({
        sessionId: session.sessionId ?? "default",
        mode: session.mode,
        verbose,
        enabledSkills: session.sessionSkills,
    });

    printSessionHeader(session.mode, toolSurface(session.mode));
    printNotice(skillStatusLine());
    if (unavailable.length > 0) {
        printHint(
            `Ignoring unavailable skills: ${unavailable.join(", ")}. Run /skills to review what this build can use.`,
        );
    }
    printHint("Type /help to see the available commands.");

    // Check for unfinished sessions and offer resumption
    const unfinished = findUnfinishedSessions();
    if (unfinished.length > 0) {
        printNotice(`Found ${unfinished.length} unfinished session(s). Type 'resume <session-id>' to continue, or proceed with a new task.`);
        for (const ctx of unfinished) {
            printHint(`  ${ctx.taskId}: ${ctx.originalTask.slice(0, 60)} (phase: ${ctx.phase}, approved: ${ctx.approvalStatus === "approved"})`);
        }
    }

    const onInterrupt = () => {
        void sayGoodbye(session);
    };
    process.on("SIGINT", onInterrupt);

    try {
        while (true) {
            const line = await askForInput();
            if (line === null) {
                break;
            }

            const text = line.trim();
            if (text === "") {
                continue;
            }

            const outcome = await runSlashCommand(text, session, { verbose });
            if (outcome === "quit") {
                break;
            }
            if (outcome === "handled") {
                continue;
            }

            // Handle resume command
            if (text.toLowerCase().startsWith("resume ")) {
                const sessionId = text.slice(7).trim();
                const result = await runner.resumeSession(sessionId);
                printNotice(result.message);
                if (result.success) {
                    printHint("Session resumed. Continue with your task.");
                }
                continue;
            }

            // Handle milestone command
            if (text.toLowerCase().startsWith("milestone ")) {
                const parts = text.slice(10).trim().split(/\s+/);
                const action = parts[0]?.toLowerCase();
                const milestoneId = parts[1];

                if (action === "list") {
                    printNotice(runner.getMilestoneSummary());
                    const next = runner.getNextReadyMilestone();
                    if (next) {
                        printHint(`Next ready: ${next.id} - ${next.objective}`);
                    }
                    continue;
                }

                if (action === "start" && milestoneId) {
                    const result = await runner.startMilestoneWithCheckpoint(milestoneId);
                    if (result.success) {
                        printSuccess(`Milestone ${milestoneId} started.`);
                    } else {
                        printFailure(result.reason ?? "Cannot start milestone");
                    }
                    continue;
                }

                if (action === "complete" && milestoneId) {
                    const result = await runner.completeMilestoneWithVerification(milestoneId);
                    if (result.success) {
                        printSuccess(`Milestone ${milestoneId} completed and verified.`);
                    } else {
                        printFailure(result.reason ?? "Cannot complete milestone");
                    }
                    continue;
                }

                if (action === "fail" && milestoneId) {
                    const error = parts.slice(2).join(" ") || "Unknown error";
                    await runner.failMilestone(milestoneId, error);
                    printNotice(`Milestone ${milestoneId} marked as failed.`);
                    continue;
                }

                if (action === "retry" && milestoneId) {
                    const result = await runner.retryMilestone(milestoneId);
                    if (result.success) {
                        printSuccess(`Milestone ${milestoneId} retried and started.`);
                    } else {
                        printFailure(result.reason ?? "Cannot retry milestone");
                    }
                    continue;
                }

                if (action === "verify" && milestoneId) {
                    const result = await runner.verifyMilestone(milestoneId);
                    printNotice(`Verification: ${result.passed ? "PASSED" : "FAILED"} (${result.checks.length} checks)`);
                    for (const check of result.checks) {
                        if (check.status !== "passed") {
                            printHint(`  ${check.name}: ${check.status}`);
                        }
                    }
                    continue;
                }

                printHint("Usage: milestone <list|start|complete|fail|retry|verify> [milestone-id] [error]");
                continue;
            }

            // Run the adaptive workflow: discovery, clarification, planning,
            // approval, then implementation. Returns "proceed" when the normal
            // agent turn should run.
            const workflowResult = await runner.processUserMessage(text);

            switch (workflowResult.action) {
                case "ask_workflow": {
                    printNotice(workflowResult.message ?? "");
                    continue;
                }
                case "ask_clarification": {
                    printNotice(workflowResult.message ?? "");
                    continue;
                }
                case "plan_created": {
                    printNotice(workflowResult.message ?? "");
                    if (workflowResult.manifest) {
                        printNotice(`[SKILL MANIFEST] ${manifestSummary(workflowResult.manifest)}`);
                    }
                    printHint("Reply 'approve' to authorize writes, or 'revise' to change the plan.");
                    continue;
                }
                case "plan_approved": {
                    printNotice(workflowResult.message ?? "Plan approved.");
                    break;
                }
                case "plan_revised": {
                    printNotice(workflowResult.message ?? "Plan revised.");
                    continue;
                }
                case "proceed":
                    break;
            }

            // The selector uses the session's enabled list, which /skills refreshes
            // by recreating the query. Selection therefore cannot suggest a skill
            // that the session's UseSkill server would reject.
            const selection = selectSkills(text, {
                mode: session.mode,
                enabledSkills: session.sessionSkills,
            });
            if (selection.selected.length > 0) {
                printNotice(`[ROUTER] Selected ${selection.selected.length} skill(s): ${selection.selected.join(", ")} (budget ${selection.budget.used}/${selection.budget.limit} tokens).`);
            } else {
                printNotice("[ROUTER] No skills selected for this request.");
            }
            if (verbose) {
                printHint(describeRouting(toRouterResult(selection)));
            }

            // If a skill manifest is approved, inject selected skill bodies into context
            const approvedSkillContext = runner.buildSkillContextForTurn();
            const skillContext = approvedSkillContext
                ? approvedSkillContext
                : (formatSkillShortlist(toRouterResult(selection)) ?? undefined);

            await runTurn(session, text, {
                verbose,
                skillContext,
                skillSelection: selection,
            });

            // Sync milestones from plan after turn completes
            await runner.syncMilestonesFromPlan();

            // Run verification after implementation turns (only when files were written)
            if (runner.getContext()?.phase === "implementation") {
                const { runVerification } = await import("../workflow/verification.js");
                const result = runVerification();
                // Only report if there are actual failures or the project has a package.json
                const hasFailures = result.checks.some((c) => c.status === "failed");
                if (hasFailures || result.checks.length > 3) {
                    printNotice(`[VERIFY] Overall: ${result.overall} (${result.checks.length} checks)`);
                    for (const check of result.checks) {
                        if (check.status !== "passed") {
                            printHint(`  ${check.name}: ${check.status}${check.detail ? " - " + check.detail : ""}`);
                        }
                    }
                }
            }
        }
    } finally {
        process.removeListener("SIGINT", onInterrupt);
        await sayGoodbye(session);
    }
}

function manifestSummary(manifest: { selected: string[]; rejected: number | string[]; unavailable: number | string[]; budget: { used: number; limit: number } }): string {
    const rejectedCount = Array.isArray(manifest.rejected) ? manifest.rejected.length : manifest.rejected;
    const unavailableCount = Array.isArray(manifest.unavailable) ? manifest.unavailable.length : manifest.unavailable;
    return `selected=${manifest.selected.join(", ") || "none"}, rejected=${rejectedCount}, unavailable=${unavailableCount}, budget=${manifest.budget.used}/${manifest.budget.limit}`;
}

async function askForInput(): Promise<string | null> {
    try {
        return await input({ message: style.bold("You:") });
    } catch {
        return null;
    }
}

async function sayGoodbye(session: AgentSession): Promise<void> {
    stopSpinner();
    printGoodbye();
    await closeSession(session);
    process.exit(0);
}