import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { printMessage, type PrintOptions } from "./message-printer.js";
import type { AgentSession } from "./session.js";
import { describeError, printFailure, printHint, printNotice, printWarning } from "../ui/messages.js";
import { startSpinner, stopSpinner } from "../ui/spinner.js";
import { recordProviderFailure, recordRequest } from "../config/usage-counter.js";
import { classifyProviderFailure, formatProviderFailure } from "./provider-errors.js";
import { TurnMonitor } from "./turn-monitor.js";
import { RunReportBuilder, createRunId, writeRunReport, defaultRunReportPath } from "./run-report.js";
import { MODES } from "./modes.js";
import { maxBudgetUsd, primaryModel } from "../config/models.js";
import { readAppConfig } from "../config/app-config.js";
import { availableEnabledSkills } from "../skills/registry.js";
import {
    initSessionLog,
    appendSessionEntry,
    appendTurnHeader,
    writeSessionSummary,
    createSessionId,
    getSessionDir,
} from "../memory/session-log.js";
import { retrieveMemory, formatMemoryContext, memoryRetrievalSummary } from "../memory/retrieval.js";

export type TurnOptions = PrintOptions & {
    /** Task-specific skill shortlist injected before the user's request. */
    skillContext?: string;
    /** Full skill selection for this turn (for lifecycle tracking). */
    skillSelection?: import("../skills/selection.js").SkillSelection;
};

export async function runTurn(
    session: AgentSession,
    input: string,
    options: TurnOptions = {},
): Promise<void> {
    const counter = recordRequest();
    if (!counter.allowed) {
        printFailure(counter.minuteWarning ?? counter.dayWarning ?? "Request blocked by free tier limits.");
        stopSpinner();
        return;
    }
    if (counter.minuteWarning) {
        printNotice(counter.minuteWarning);
    }
    if (counter.dayWarning) {
        printNotice(counter.dayWarning);
    }

    const monitor = new TurnMonitor();
    // Held in an object so the value assigned inside the callback is visible
    // after the drain loop without relying on TypeScript's narrowing.
    const outcome: { result: Extract<SDKMessage, { type: "result" }> | null } = { result: null };
    let stoppedReason: string | null = null;

    // Per-turn run report builder for observability.
    const selection = options.skillSelection;
    const enabledSkills = session.sessionSkills;
    const builder = new RunReportBuilder(
        {
            mode: session.mode,
            prompt: input,
            model: primaryModel(),
            selection: selection ?? {
                candidates: [],
                enabled: enabledSkills,
                recommended: [],
                selected: [],
                scores: [],
                budget: { used: 0, limit: 6000, over: false },
            },
            availableSkills: enabledSkills,
            consultedReferences: [],
            tools: [...MODES[session.mode].tools, "UseSkill"],
            permissionMode: MODES[session.mode].permissionMode,
            maxTurns: MODES[session.mode].maxTurns,
            maxBudgetUsd: maxBudgetUsd(),
            mcpServers: ["node-cli", "node-cli-images"],
            selectionVersion: "interactive-turn",
        },
        createRunId(),
    );

    startSpinner("Agent working...");
    const sessionId = session.sessionId ?? "default";
    const projectRoot = process.cwd();

    // Persist user message to session log (non-fatal)
    try { initSessionLog(sessionId, projectRoot); } catch { /* non-fatal */ }
    try {
        appendSessionEntry(sessionId, {
            id: `user-${Date.now()}`,
            role: "user",
            timestamp: new Date().toISOString(),
            content: input,
        }, projectRoot);
    } catch { /* non-fatal */ }

    // Retrieve relevant memory from previous sessions (non-fatal)
    let memoryContext = "";
    try {
        const memResult = retrieveMemory(input, { projectRoot, budgetChars: 1500 });
        memoryContext = formatMemoryContext(memResult);
        if (memResult.entries.length > 0) {
            printNotice(`[MEMORY] ${memoryRetrievalSummary(memResult)}`);
        }
    } catch { /* non-fatal */ }

    const prompt = [options.skillContext, memoryContext, input].filter(Boolean).join("\\n\\n");
    session.inputQueue.push(prompt);

    try {
        await drainUntilResult(
            session.stream,
            (message) => {
                rememberSessionId(session, message);
                // Track api_retry events if present
                if ((message as any).type === "system" && (message as any).subtype === "api_retry") {
                    const m = message as any;
                    builder.recordRetry({
                        attempt: typeof m.attempt === "number" ? m.attempt : undefined,
                        maxRetries: typeof m.max_retries === "number" ? m.max_retries : undefined,
                        retryDelayMs: typeof m.retry_delay_ms === "number" ? m.retry_delay_ms : undefined,
                        errorStatus: m.error_status === null || typeof m.error_status === "number" ? m.error_status : undefined,
                        errorCategory: typeof m.error === "string" ? m.error : typeof m.message === "string" ? m.message : undefined,
                    });
                }
                builder.observe(message);
                // Print real-time skill request notice
                if (message.type === "assistant") {
                    const content = (message as any).message?.content;
                    if (Array.isArray(content)) {
                        for (const block of content) {
                            if (block?.type === "tool_use" && (block.name === "UseSkill" || block.name?.endsWith("__UseSkill"))) {
                                const skillId = block.input?.skillId;
                                if (skillId) {
                                    printNotice(`[SKILL] ${skillId} requested by model.`);
                                }
                            }
                        }
                    }
                    // Persist assistant text to session log
                    const text = Array.isArray(content)
                        ? content.filter((b: any) => b?.type === "text").map((b: any) => b.text).join("")
                        : "";
                    if (text.trim()) {
                        try {
                            appendSessionEntry(sessionId, {
                                id: `assistant-${Date.now()}`,
                                role: "assistant",
                                timestamp: new Date().toISOString(),
                                content: text.trim(),
                            }, projectRoot);
                        } catch { /* non-fatal */ }
                    }
                }
                printMessage(message, options);
                if (message.type === "result") outcome.result = message;
            },
            (message) => {
                const update = monitor.observe(message);
                if (update.warning) {
                    printWarning(`[LOOP] ${update.warning}`);
                }
                if (update.stop) {
                    stoppedReason = update.reason ?? "The turn stopped because it could not make progress.";
                    return true;
                }
                return false;
            },
        );

        if (stoppedReason) {
            await quietly(() => session.query.interrupt());
            printFailure(`Stopped: ${stoppedReason}`);
            printHint("Nothing was replayed. Change the command, inputs, or approach before retrying.");
            return;
        }

        if (outcome.result && outcome.result.subtype === "success") {
            for (const warning of monitor.completionWarnings()) {
                printWarning(`Verification: ${warning}`);
            }
        } else if (outcome.result) {
            const failure = classifyProviderFailure(
                new Error(outcome.result.errors?.join(", ") || outcome.result.subtype),
            );
            if (failure.kind !== "unknown") {
                recordProviderFailure(failure);
            }
        }
    } catch (error) {
        // A failed turn can leave a stale session id (e.g. model switched mid-chat).
        // Clear it so the next turn starts a fresh conversation.
        session.sessionId = undefined;
        const failure = classifyProviderFailure(error);
        recordProviderFailure(failure);
        printFailure(formatProviderFailure(failure));
        if (failure.retryable) {
            printHint("The SDK's retries are bounded. Wait for the retry window instead of resending the same request.");
        }
        if (process.env.NODE_CLI_DEBUG === "1") {
            printHint(describeError(error));
        }
    } finally {
        stopSpinner();

        // Print per-turn skill lifecycle summary
        const report = builder.finish({
            result: outcome.result,
            timedOut: stoppedReason !== null,
            cancelled: false,
            error: null,
        });
        if (report.skills.requested.length > 0 || report.skills.selected.length > 0) {
            printNotice(
                `Turn skill lifecycle: selected=${report.skills.selected.join(", ") || "none"}, ` +
                    `requested=${report.skills.requested.join(", ") || "none"}, ` +
                    `loaded=${report.skills.loaded.join(", ") || "none"}, ` +
                    `repeated=${report.skills.repeatedRetrievals}.`,
            );
        }
        printNotice(
            `Turn summary: toolCalls=${report.toolSummary.total} ` +
                `(success=${report.toolSummary.succeeded}, failed=${report.toolSummary.failed}), ` +
                `retries=${report.diagnostics?.retries?.length ?? 0}.`,
        );
    }
}

export async function drainUntilResult(
    stream: AsyncIterator<SDKMessage>,
    onMessage: (message: SDKMessage) => void,
    shouldStop?: (message: SDKMessage) => boolean,
): Promise<void> {
    while (true) {
        const { value, done } = await stream.next();
        if (done) {
            return;
        }
        onMessage(value);
        if (shouldStop?.(value)) {
            return;
        }
        if (value.type === "result") {
            return;
        }
    }
}

function rememberSessionId(session: AgentSession, message: SDKMessage): void {
    if (message.type === "system" && message.subtype === "init") {
        session.sessionId = message.session_id;
    }
}

async function quietly(action: () => unknown): Promise<void> {
    try {
        await action();
    } catch {
        // Best effort: the turn is already being stopped.
    }
}
