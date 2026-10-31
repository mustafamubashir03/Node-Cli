import {
    query,
    type Query,
    type SDKMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { setActiveMode } from "../agent/active-mode.js";
import { DeadlineExceededError, nextWithDeadline, settleWithin } from "../agent/deadline.js";
import { printMessage } from "../agent/message-printer.js";
import { MODES, type Mode } from "../agent/modes.js";
import {
    RunReportBuilder,
    createRunId,
    defaultRunReportPath,
    writeRunReport,
    type SdkRetryEvent,
    type RunReport,
} from "../agent/run-report.js";
import { buildInteractiveSdkOptions } from "../agent/sdk-options.js";
import { readAppConfig } from "../config/app-config.js";
import { requireCredentials } from "../config/env.js";
import { maxBudgetUsd, primaryModel } from "../config/models.js";
import { promptForCredentials } from "../config/setup.js";
import { availableEnabledSkills } from "../skills/registry.js";
import { retrieveMemory, formatMemoryContext, memoryRetrievalSummary } from "../memory/retrieval.js";
import { findProjectRoot } from "../memory/memory.js";
import { consultFrontendReferences } from "../skills/frontend-references.js";
import { isFrontendIntent } from "../skills/router.js";
import { resolveResources } from "../skills/resource-resolver.js";
import { formatSkillShortlist, type RouterResult } from "../skills/router.js";
import {
    SKILL_SELECTION_VERSION,
    selectSkills,
    toRouterResult,
} from "../skills/selection.js";
import { describeError, printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";
import { stopSpinner } from "../ui/spinner.js";

export type OneShotOptions = {
    mode?: Mode;
    verbose?: boolean;
    timeoutMs?: number;
    /** Test seam: disable the compact frontend design plan (baseline comparison). Defaults to true. */
    frontendDesignPlan?: boolean;
    /** JSON report path; set to "off" to disable the automatic report. */
    reportPath?: string;
    /**
     * Test seam for the SDK boundary. Production callers omit this and the real
     * SDK `query` is used. Tests inject a fake query to assert the exact
     * request and replay controlled tool results without credentials.
     */
    sdkQueryFactory?: (request: { prompt: string; options: unknown }) => {
        [Symbol.asyncIterator](): AsyncIterator<SDKMessage>;
        interrupt?: () => Promise<unknown>;
        return?: () => Promise<unknown>;
        close?: () => void;
    };
};

const DEFAULT_RUN_TIMEOUT_MS = 120_000;
const CLEANUP_TIMEOUT_MS = 3_000;

export async function runOneShotPrompt(
    prompt: string,
    options: OneShotOptions = {},
): Promise<void> {
    await promptForCredentials();
    requireCredentials();

    const { mode = "agent", verbose = false } = options;
    setActiveMode(mode);

    const timeoutMs =
        options.timeoutMs && options.timeoutMs > 0
            ? options.timeoutMs
            : Number(process.env.NODE_CLI_RUN_TIMEOUT_MS) || DEFAULT_RUN_TIMEOUT_MS;
    const configuredSkills = readAppConfig().skills ?? [];
    const enabledSkills = availableEnabledSkills(configuredSkills);
    const selection = selectSkills(prompt, {
        mode,
        enabledSkills: configuredSkills,
    });
    const routerResult: RouterResult = toRouterResult(selection);
    const consulted = consultFrontendReferences(prompt);
    const consultedReferences = consulted.consulted;
    // Resolve on-demand resources (bounded). Mark delivered when included in prompt.
    const resolved = await resolveResources(consultedReferences);
    const RESOURCE_EXCERPT_LIMIT = 1200;
    const TOTAL_RESOURCE_BUDGET = 6000;
    let resourceSection = "";
    let used = 0;
    const resolutionReport: NonNullable<RunReport["resourceResolution"]> = [];
    for (const r of resolved) {
        const entry: NonNullable<RunReport["resourceResolution"]>[number] = {
            id: r.id,
            status: r.status,
            files: r.files,
            contentHash: r.contentHash,
            bytes: r.bytes,
            error: r.error,
            revision: r.revision,
            delivered: false,
        };
        if (r.status === "FETCHED" && r.content) {
            const excerpt = r.content.slice(0, RESOURCE_EXCERPT_LIMIT);
            const block = `\n### Reference: ${r.id} (${r.files.join(", ")})\n${excerpt}\n`;
            if (used + block.length <= TOTAL_RESOURCE_BUDGET) {
                resourceSection += block;
                used += block.length;
                entry.status = "DELIVERED";
                entry.delivered = true;
            } else {
                entry.error = (entry.error ? entry.error + "; " : "") + "Omitted due to resource budget.";
            }
        }
        resolutionReport.push(entry);
    }
    const frontendPlanEnabled = options.frontendDesignPlan !== false;
    const frontendPlan = frontendPlanEnabled && isFrontendIntent(prompt)
        ? [
              "## Frontend design plan (compact, required before code)",
              "1. Inspect existing project, framework, styling system, installed libs.",
              "2. Identify product type, users, content hierarchy, key interaction.",
              "3. Choose a deliberate art direction; state its defining traits.",
              "4. Reuse existing DESIGN.md/tokens if present; otherwise define coherent colors, type, spacing, radii, shadows, states.",
              "5. Select compatible components; do not install libs merely because cataloged.",
              "6. Implement real functionality/content; avoid placeholders and generic card grids.",
              "7. Verify build/typecheck and report evidence.",
          ].join("\n")
        : "";
    // Retrieve relevant memory from previous sessions
    let memorySection = "";
    try {
        const projectRoot = findProjectRoot();
        const memResult = retrieveMemory(prompt, { projectRoot, budgetChars: 1500 });
        memorySection = formatMemoryContext(memResult);
        if (memResult.entries.length > 0) {
            printNotice(`[MEMORY] ${memoryRetrievalSummary(memResult)}`);
        }
    } catch {
        // Non-fatal
    }

    const promptWithResources =
        [prompt, frontendPlan, memorySection, resourceSection.trim().length > 0 ? `## Resolved frontend references (authentic, fetched)\n${resourceSection}` : ""]
            .filter(Boolean)
            .join("\n\n");

    const model = primaryModel();
    const runId = createRunId();
    const builder = new RunReportBuilder(
        {
            mode,
            prompt,
            model,
            selection,
            availableSkills: enabledSkills,
            consultedReferences,
            resourceResolution: resolutionReport,
            tools: toolsForReport(mode),
            permissionMode: MODES[mode].permissionMode,
            maxTurns: MODES[mode].maxTurns,
            maxBudgetUsd: maxBudgetUsd(),
            mcpServers: ["node-cli", "node-cli-images"],
            selectionVersion: SKILL_SELECTION_VERSION,
        },
        runId,
    );

    const startedAt = Date.now();
    const phase = (name: string) => {
        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        printNotice(`[${elapsed}s] Phase: ${name}`);
    };

    phase("initialization complete");
    printNotice(`Model: ${model} (provider OpenRouter); mode: ${mode}.`);
    printNotice(
        `Skills: enabled ${enabledSkills.length}, recommended ${selection.recommended.length}` +
            `${selection.recommended.length > 0 ? ` (${selection.recommended.join(", ")})` : ""}, ` +
            `selected ${selection.selected.length}, available in prompt ${enabledSkills.length}, loaded 0.`,
    );
    if (selection.selected.length > 0) {
        printNotice(`Skill delivery: selected [${selection.selected.join(", ")}] will be available via UseSkill; activation requires model to call mcp__node-cli__UseSkill.`);
    } else {
        printNotice(`Skill delivery: no skills selected for this task.`);
    }
    if (configuredSkills.length !== enabledSkills.length) {
        const ignored = configuredSkills.filter((id) => !enabledSkills.includes(id));
        printHint(`Ignoring unavailable skills: ${ignored.join(", ")}.`);
    }
    phase("provider setup complete");

    let timedOut = false;
    let cancelled = false;
    let resultMessage: Extract<SDKMessage, { type: "result" }> | null = null;
    let runError: unknown = null;
    let lastToolCount = 0;
    let modelTurns = 0;
    let sdkQuery: Query | null = null;
    let iterator: AsyncIterator<SDKMessage> | null = null;
    let heartbeatInterval: NodeJS.Timeout | null = null;

    const onSigint = () => {
        cancelled = true;
        builder.recordInterruptionBegin();
        printNotice("Cancellation requested; interrupting the run.");
        void sdkQuery?.interrupt().catch(() => undefined);
    };
    process.on("SIGINT", onSigint);

    try {
        phase("model request sent");
        const sdkOptions = buildInteractiveSdkOptions(mode, enabledSkills);
        const createQuery = options.sdkQueryFactory ?? query;
        sdkQuery = createQuery({ prompt: withSkillShortlist(promptWithResources, routerResult), options: sdkOptions }) as Query;
        iterator = sdkQuery[Symbol.asyncIterator]();

        // Lightweight heartbeat while waiting for SDK events
        heartbeatInterval = setInterval(() => {
            try {
                builder.recordHeartbeat();
            } catch {
                // ignore
            }
        }, 1000);

        const deadline = startedAt + timeoutMs;
        while (true) {
            const { value, done } = await nextWithDeadline(iterator, deadline, () => {
                timedOut = true;
                builder.recordInterruptionBegin();
            });
            if (done) break;

            const message = value;
            // Track api_retry events if present
            if ((message as any).type === "system" && (message as any).subtype === "api_retry") {
                const m = message as any;
                const retry: Partial<SdkRetryEvent> = {
                    attempt: typeof m.attempt === "number" ? m.attempt : undefined,
                    maxRetries: typeof m.max_retries === "number" ? m.max_retries : undefined,
                    retryDelayMs: typeof m.retry_delay_ms === "number" ? m.retry_delay_ms : undefined,
                    errorStatus: m.error_status === null || typeof m.error_status === "number" ? m.error_status : undefined,
                    retryAfterSeconds:
                        m.retry_after === null || typeof m.retry_after === "number"
                            ? m.retry_after
                            : m.retryAfter === null || typeof m.retryAfter === "number"
                              ? m.retryAfter
                              : undefined,
                    errorCategory: typeof m.error === "string" ? m.error : typeof m.message === "string" ? m.message : undefined,
                };
                builder.recordRetry(retry);
            }
            builder.observe(message);
            printMessage(message, { verbose });

            if (message.type === "assistant") {
                modelTurns += 1;
                phase(`model turn ${modelTurns} complete`);
            }

            const summary = builder.getToolSummary();
            if (summary.total !== lastToolCount) {
                lastToolCount = summary.total;
                const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
                printNotice(
                    `[${elapsed}s] Tool calls: ${summary.total} ` +
                        `(success ${summary.succeeded}, failed ${summary.failed}, pending ${summary.pending}).`,
                );
            }

            if (message.type === "result") {
                resultMessage = message;
                break;
            }
        }
    } catch (error) {
        if (error instanceof DeadlineExceededError) {
            timedOut = true;
            builder.recordInterruptionBegin();
            try { builder.setTimeoutClassification("deadline", error.message); } catch {}
        }
        runError = error;
    } finally {
        if (heartbeatInterval) {
            clearInterval(heartbeatInterval);
            heartbeatInterval = null;
        }
        process.removeListener("SIGINT", onSigint);
        stopSpinner();

        let cleanupOk = true;
        if (timedOut || cancelled) {
            const start = Date.now();
            await settleWithin(sdkQuery?.interrupt(), CLEANUP_TIMEOUT_MS);
            await settleWithin(iterator?.return?.(), CLEANUP_TIMEOUT_MS);
            if (Date.now() - start >= CLEANUP_TIMEOUT_MS) {
                cleanupOk = false;
            }
        }

        if (timedOut || cancelled) {
            builder.recordInterruptionEnd(cleanupOk);
        } else {
            builder.recordInterruptionEnd(cleanupOk);
        }

        const report = builder.finish({
            result: resultMessage,
            timedOut,
            cancelled,
            error: runError,
        });

        const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
        if (report.termination.reason === "completed") {
            printSuccess("Run completed successfully.");
        } else {
            printFailure(
                `[${elapsed}s] Phase: ${report.termination.reason} — ${report.termination.detail}`,
            );
            printTerminationHint(report.termination.reason);
        }

        printNotice(
            `Final summary: termination=${report.termination.reason}, elapsed=${elapsed}s, ` +
                `turns=${report.usage.turns}, toolCalls=${report.toolSummary.total} ` +
                `(success=${report.toolSummary.succeeded}, failed=${report.toolSummary.failed}, ` +
                `pending=${report.toolSummary.pending}), tokens=in:${report.usage.inputTokens}/` +
                `out:${report.usage.outputTokens}, cost=$${report.usage.costUsd.toFixed(6)}.`,
        );
        printNotice(
            `Skill lifecycle: recommended=${list(report.skills.recommended)}, ` +
                `selected=${list(report.skills.selected)}, available=${report.skills.available.length}, ` +
                `requested=${list(report.skills.requested)}, loaded=${list(report.skills.loaded)}, ` +
                `repeated=${report.skills.repeatedRetrievals}.`,
        );

        const reportPath = resolveReportPath(options.reportPath, runId);
        if (reportPath) {
            try {
                const written = writeRunReport(report, reportPath);
                printHint(`Run report: ${written.jsonPath}`);
                printHint(`Run summary: ${written.markdownPath}`);
            } catch (error) {
                printHint(`Could not write the run report: ${describeError(error)}`);
            }
        }

        process.exitCode = report.termination.exitCode;
    }
}

function toolsForReport(mode: Mode): string[] {
    return [...MODES[mode].tools, "UseSkill"];
}

function withSkillShortlist(prompt: string, result: RouterResult): string {
    const shortlist = formatSkillShortlist(result);
    return shortlist ? `${shortlist}\n\n${prompt}` : prompt;
}

function resolveReportPath(optionPath: string | undefined, runId: string): string | null {
    const configured = optionPath ?? process.env.NODE_CLI_RUN_REPORT;
    if (configured && /^(off|none|false)$/i.test(configured.trim())) return null;
    if (configured && configured.trim()) return configured.trim();
    return defaultRunReportPath(runId);
}

function printTerminationHint(reason: string): void {
    switch (reason) {
        case "timeout":
            printHint(
                "The total time budget was reached. The run was interrupted and its diagnostics were kept. " +
                    "Use a smaller task or a deliberate --timeout value before retrying.",
            );
            return;
        case "turn_limit":
            printHint(
                "The model reached maxTurns. Split the task into smaller steps or continue with a follow-up run; " +
                    "the limit is a safety boundary, not a model failure.",
            );
            return;
        case "budget_limit":
            printHint(
                "The configured spending budget was reached. Inspect the report before deliberately changing MAX_BUDGET_USD.",
            );
            return;
        case "tool_failure":
            printHint("Every observed tool call failed. Inspect the tool table in the run report.");
            return;
        case "incomplete":
            printHint("The SDK stream ended without a result message. Treat the output as unverified.");
            return;
        case "provider_error":
            printHint("The provider rejected or failed the request. See the classification above before retrying.");
            return;
        case "cancelled":
            printHint("The run was cancelled. Partial output is not verified.");
            return;
        default:
            printHint("Inspect the run report for the failing phase and tool history.");
    }
}

function list(values: string[]): string {
    return values.length === 0 ? "none" : values.join(", ");
}
