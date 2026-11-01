import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { redactSecrets } from "../security/redact.js";

const REPEATED_FAILURE_LIMIT = 3;
const MAX_TRACKED_CALLS = 500;
const REPEATED_TEXT_LIMIT = 3;

export type ToolCallRecord = {
    id: string;
    name: string;
    input: Record<string, unknown>;
    status: "pending" | "success" | "failed";
    errorSignature?: string;
    duplicate?: boolean;
};

export type TurnSummary = {
    toolCalls: number;
    failedToolCalls: number;
    successfulToolCalls: number;
    duplicateToolUseIds: string[];
    writesAttempted: string[];
    writesFailed: string[];
    writesMissing: string[];
};

export type MonitorUpdate = {
    stop: boolean;
    reason?: string;
    /** Non-retryable warning injected when a failure repeats but hasn't hard-stopped yet. */
    warning?: string;
};

/**
 * Observes one accumulated turn without re-executing anything. It is a guard,
 * not a replacement for the SDK's tool loop: it catches replayed tool-use IDs,
 * repeated identical failures, and unverified write claims.
 */
export class TurnMonitor {
    private readonly calls = new Map<string, ToolCallRecord>();
    private readonly duplicateIds = new Set<string>();
    private lastFailureSignature: string | null = null;
    private consecutiveFailures = 0;
    private stopReason: string | null = null;
    private lastAssistantText: string | null = null;
    private consecutiveTextRepeats = 0;
    // Rolling window for loop detection (workstream 4.1)
    private readonly toolWindow: { tool: string; argsHash: string; errorSig: string | null }[] = [];
    private readonly MAX_WINDOW_SIZE = 20;
    // Track non-progress: success but no state change
    private lastSuccessfulWritePath: string | null = null;
    private nonProgressCount = 0;

    observe(message: SDKMessage): MonitorUpdate {
        switch (message.type) {
            case "assistant":
                this.observeAssistant(message.message.content);
                break;
            case "user":
                this.observeToolResults(message.message.content);
                break;
            case "result":
                if (message.subtype !== "success" && !this.stopReason) {
                    this.stopReason = `Provider/tool loop ended without success (${message.subtype}).`;
                }
                break;
            default:
                break;
        }

        const warning = this.pendingWarning ?? undefined;
        this.pendingWarning = null;
        if (this.stopReason) {
            return { stop: true, reason: this.stopReason, warning };
        }
        if (warning) {
            return { stop: false, warning };
        }
        return { stop: false };
    }

    summary(): TurnSummary {
        const all = [...this.calls.values()];
        const writes = all.filter((call) => isWriteTool(call.name));
        const writesAttempted = writes.map((call) => writePath(call.input)).filter(isNonEmptyString);
        const writesFailed = writes
            .filter((call) => call.status === "failed")
            .map((call) => writePath(call.input))
            .filter(isNonEmptyString);
        const writesMissing = writes
            .filter((call) => call.status !== "failed")
            .map((call) => writePath(call.input))
            .filter(isNonEmptyString)
            .filter((path) => !fileLooksPresent(path));

        return {
            toolCalls: all.length,
            failedToolCalls: all.filter((call) => call.status === "failed").length,
            successfulToolCalls: all.filter((call) => call.status === "success").length,
            duplicateToolUseIds: [...this.duplicateIds],
            writesAttempted,
            writesFailed,
            writesMissing,
        };
    }

    /** Concrete evidence gaps, phrased as cautions rather than success claims. */
    completionWarnings(): string[] {
        const summary = this.summary();
        const warnings: string[] = [];

        if (summary.duplicateToolUseIds.length > 0) {
            warnings.push(
                `A replayed tool-call ID was observed (${summary.duplicateToolUseIds.join(", ")}). The guard blocks re-execution; verify that the original side effect completed.`,
            );
        }
        if (summary.writesFailed.length > 0) {
            warnings.push(`Write/Edit failed for: ${summary.writesFailed.join(", ")}. Those files are not verified artifacts.`);
        }
        if (summary.writesMissing.length > 0) {
            warnings.push(`Write/Edit tool calls did not leave a non-empty file at: ${summary.writesMissing.join(", ")}.`);
        }
        if (summary.failedToolCalls > 0 && summary.writesAttempted.length === 0) {
            warnings.push("Tool calls failed and no successful file write was observed. The task is not verified as complete.");
        }

        return [...new Set(warnings)];
    }

    private observeAssistant(content: unknown): void {
        // Detect repeated identical assistant narration as a loop signal.
        const text = assistantText(content);
        if (text && text.length >= 40) {
            if (text === this.lastAssistantText) {
                this.consecutiveTextRepeats += 1;
            } else {
                this.lastAssistantText = text;
                this.consecutiveTextRepeats = 1;
            }
            if (this.consecutiveTextRepeats >= REPEATED_TEXT_LIMIT && !this.stopReason) {
                this.stopReason =
                    "Stopped after repeated identical assistant explanations without progress. " +
                    "Change approach or inputs before retrying.";
            }
        }

        for (const block of contentBlocks(content)) {
            if (!isRecord(block) || block.type !== "tool_use") continue;
            const id = typeof block.id === "string" ? block.id : "";
            if (!id) continue;
            if (this.calls.has(id)) {
                this.duplicateIds.add(id);
                const existing = this.calls.get(id);
                if (existing) existing.duplicate = true;
                continue;
            }
            if (this.calls.size >= MAX_TRACKED_CALLS) continue;
            const input = isRecord(block.input) ? block.input : {};
            this.calls.set(id, {
                id,
                name: typeof block.name === "string" ? block.name : "unknown",
                input,
                status: "pending",
            });
        }
    }

    private pendingWarning: string | null = null;

    private observeToolResults(content: unknown): void {
        this.pendingWarning = null;
        for (const block of contentBlocks(content)) {
            if (!isRecord(block) || block.type !== "tool_result") continue;
            const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
            if (!id) continue;

            const call = this.calls.get(id);
            if (!call) continue;
            if (call.status !== "pending") continue;

            const failed = block.is_error === true;
            call.status = failed ? "failed" : "success";

            // Compute args hash for loop detection
            const argsHash = JSON.stringify(call.input).slice(0, 200);
            const errorSig = failed ? failureSignature(call.name, block.content) : null;

            // Add to rolling window
            this.toolWindow.push({ tool: call.name, argsHash, errorSig });
            if (this.toolWindow.length > this.MAX_WINDOW_SIZE) {
                this.toolWindow.shift();
            }

            if (failed) {
                const signature = errorSig!;
                call.errorSignature = signature;
                if (signature === this.lastFailureSignature) {
                    this.consecutiveFailures += 1;
                } else {
                    this.lastFailureSignature = signature;
                    this.consecutiveFailures = 1;
                }

                // Inject warning on 2nd identical failure (before hard stop)
                if (this.consecutiveFailures === REPEATED_FAILURE_LIMIT - 1) {
                    this.pendingWarning =
                        `This failed ${this.consecutiveFailures} time(s) with the same error. ` +
                        `Do not retry the same approach. Choose a different method or ask the user.`;
                }

                if (this.consecutiveFailures >= REPEATED_FAILURE_LIMIT) {
                    this.stopReason =
                        `Stopped after ${this.consecutiveFailures} identical '${call.name}' failures. ` +
                        "The operation did not make progress; change the command or inputs before retrying.";
                }
            } else {
                // Non-progress detection: if same write succeeds but file unchanged
                if (isWriteTool(call.name)) {
                    const path = writePath(call.input);
                    if (path && path === this.lastSuccessfulWritePath) {
                        this.nonProgressCount += 1;
                    } else {
                        this.nonProgressCount = 1;
                    }
                    this.lastSuccessfulWritePath = path;

                    if (this.nonProgressCount >= REPEATED_FAILURE_LIMIT) {
                        this.stopReason =
                            `Stopped after ${this.nonProgressCount} non-productive writes to the same path. ` +
                            "No state change detected; change the approach.";
                    }
                }
                this.lastFailureSignature = null;
                this.consecutiveFailures = 0;
            }

            // Cyclic pattern detection: check for A->B->C->A cycles
            if (this.toolWindow.length >= 6) {
                const recent = this.toolWindow.slice(-6);
                const first3 = recent.slice(0, 3).map((e) => `${e.tool}:${e.argsHash}`).join("|");
                const last3 = recent.slice(3, 6).map((e) => `${e.tool}:${e.argsHash}`).join("|");
                if (first3 === last3 && first3.length > 0) {
                    this.stopReason =
                        "Detected a cyclic tool-call pattern (A->B->C->A). " +
                        "The operation is not making progress; change the approach or ask the user.";
                }
            }
        }
    }
}

function failureSignature(toolName: string, content: unknown): string {
    const text = toolResultText(content)
        .replace(/\b[0-9a-f]{8,}\b/gi, "<id>")
        .replace(/\b\d+ms\b/g, "<time>")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 240);
    return `${toolName}:${redactSecrets(text)}`;
}

function toolResultText(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content
            .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
            .join(" ");
    }
    return "";
}

function assistantText(content: unknown): string {
    if (!Array.isArray(content)) return "";
    const parts: string[] = [];
    for (const block of content) {
        if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
            parts.push(block.text.trim());
        }
    }
    return parts.join("\n").trim();
}

function contentBlocks(content: unknown): unknown[] {
    if (Array.isArray(content)) return content;
    if (isRecord(content) && Array.isArray(content.content)) return content.content;
    return [];
}

function isWriteTool(name: string): boolean {
    return name === "Write" || name === "Edit" || name === "MultiEdit" || name === "NotebookEdit";
}

function writePath(input: Record<string, unknown>): string | null {
    const candidate = input.file_path ?? input.path;
    return typeof candidate === "string" && candidate.trim() ? candidate.trim() : null;
}

function fileLooksPresent(path: string): boolean {
    const resolved = isAbsolute(path) ? path : resolve(process.cwd(), path);
    try {
        return existsSync(resolved) && statSync(resolved).size > 0;
    } catch {
        return false;
    }
}

function isNonEmptyString(value: string | null): value is string {
    return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
