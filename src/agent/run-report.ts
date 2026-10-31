import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { redactSecrets } from "../security/redact.js";
import { getSkillInfo } from "../skills/registry.js";
import type { SkillSelection } from "../skills/selection.js";
import { classifyProviderFailure } from "./provider-errors.js";
import type { Mode } from "./modes.js";

export const RUN_REPORT_SCHEMA_VERSION = 1;

export type TerminationReason =
    | "completed"
    | "timeout"
    | "cancelled"
    | "turn_limit"
    | "budget_limit"
    | "provider_error"
    | "tool_failure"
    | "incomplete"
    | "internal_error";

export type RunToolCall = {
    id: string;
    name: string;
    input: string;
    status: "pending" | "success" | "failed";
    result?: string;
    useSkillId?: string;
};

export type RunSkillLifecycle = {
    /** All skills usable in this installation. */
    candidates: string[];
    /** Skills enabled by configuration after the availability gate. */
    enabled: string[];
    /** Skills the router ranked for this prompt. */
    recommended: string[];
    /** Skills the production path put in front of the model. */
    selected: string[];
    /** Skills whose index entry was injected into the system prompt / MCP tool. */
    available: string[];
    /** Skills observed to be successfully loaded through UseSkill in this run. */
    loaded: string[];
    /** Skills the model explicitly requested via UseSkill (distinct from router-selected). */
    requested: string[];
    /** Per-skill retrieval counts (how many times the model called UseSkill for each skill). */
    retrievalCounts: Record<string, number>;
    /** Number of repeated retrieval requests (total calls minus distinct skills). */
    repeatedRetrievals: number;
    loadFailures: { skillId: string; message: string }[];
    /** Lightweight catalog references consulted for this run (metadata/index only). */
    consultedReferences?: string[];
    selectedContextTokens: number;
    availableIndexTokens: number;
    selectionVersion: string;
};

export type RunUsage = {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
    costUsd: number;
    turns: number;
    modelUsage: Record<string, { inputTokens: number; outputTokens: number; costUsd: number }>;
};

export type SdkRetryEvent = {
    /** Monotonic timestamp when the retry event was observed (ms). */
    observedAtMs: number;
    /** Wall-clock timestamp for correlation. */
    observedAtIso: string;
    /** SDK attempt number, if provided. */
    attempt?: number;
    /** SDK max retries, if provided. */
    maxRetries?: number;
    /** Retry delay in milliseconds, if provided. */
    retryDelayMs?: number;
    /** HTTP status code, if provided. */
    errorStatus?: number | null;
    /** Error category/message fragment if available (redacted). */
    errorCategory?: string;
    /** Retry-after in seconds, if provided. */
    retryAfterSeconds?: number | null;
};

export type RunDiagnostics = {
    /** Monotonic clock start time (ms) relative to process.hrtime-like base via Date.now() + performance? We use monotonic via performance.now() pattern with Date.now() fallback; store both. */
    monotonicStartMs: number;
    wallStartIso: string;
    /** Last meaningful SDK event observed. */
    lastEvent: {
        type: string;
        subtype?: string;
        observedAtMs: number;
        observedAtIso: string;
        elapsedMs: number;
    } | null;
    /** SDK retry events observed (api_retry). */
    retries: SdkRetryEvent[];
    /** Heartbeat events while waiting for SDK iterator. */
    heartbeats: { observedAtMs: number; observedAtIso: string; elapsedMs: number }[];
    /** Interruption timing. */
    interruption: {
        beganAtMs: number | null;
        beganAtIso: string | null;
        endedAtMs: number | null;
        endedAtIso: string | null;
        cleanupCompletedWithinBound: boolean | null;
    };
    /** Timeout classification details. */
    timeoutClassification: {
        kind: "deadline" | "cleanup" | null;
        detail?: string;
    };
};

export type RunReport = {
    schemaVersion: number;
    runId: string;
    startedAt: string;
    finishedAt: string;
    elapsedMs: number;
    cwd: string;
    provider: "openrouter";
    model: string;
    mode: Mode;
    prompt: { sha256: string; length: number; preview: string };
    skills: RunSkillLifecycle;
    sdk: {
        tools: string[];
        permissionMode: string;
        maxTurns: number;
        maxBudgetUsd: number | undefined;
        mcpServers: string[];
    };
    toolCalls: RunToolCall[];
    toolSummary: {
        total: number;
        succeeded: number;
        failed: number;
        pending: number;
        imageSearchCalls: number;
        useSkillCalls: number;
    };
    usage: RunUsage;
    termination: { reason: TerminationReason; detail: string; exitCode: number };
    /** Minimal diagnostics added in Phase 10.1. */
    diagnostics?: RunDiagnostics;
    /** Resource resolution outcomes for this run. */
    resourceResolution?: {
        id: string;
        status: string;
        files: string[];
        contentHash: string | null;
        bytes: number;
        error: string | null;
        revision: string | null;
        delivered: boolean;
    }[];
};

export type RunReportInit = {
    mode: Mode;
    prompt: string;
    model: string;
    selection: SkillSelection;
    availableSkills: string[];
    tools: string[];
    permissionMode: string;
    consultedReferences?: string[];
    maxTurns: number;
    maxBudgetUsd: number | undefined;
    mcpServers: string[];
    cwd?: string;
    selectionVersion?: string;
    resourceResolution?: RunReport["resourceResolution"];
};

export type RunFinishInput = {
    result: Extract<SDKMessage, { type: "result" }> | null;
    timedOut: boolean;
    cancelled: boolean;
    error: unknown;
    /** Diagnostic state collected by the caller (Phase 10.1). */
    diagnostics?: Partial<RunDiagnostics>;
};

const PROMPT_PREVIEW_LIMIT = 280;
const TOOL_INPUT_LIMIT = 160;
const TOOL_RESULT_LIMIT = 240;
const MAX_TRACKED_TOOL_CALLS = 500;

export function createRunId(now = new Date()): string {
    const stamp = now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `run-${stamp}-${randomBytes(3).toString("hex")}`;
}

/** Separates "selected because it was recommended" from "loaded by the agent". */
export class RunReportBuilder {
    private readonly startedAt = Date.now();
    private readonly startedAtIso = new Date(this.startedAt).toISOString();
    private readonly monotonicStartMs = Date.now();
    private readonly init: RunReportInit;
    private readonly runId: string;
    private readonly calls = new Map<string, RunToolCall>();
    private readonly loaded = new Set<string>();
    private readonly requested = new Set<string>();
    private readonly retrievalCounts = new Map<string, number>();
    private readonly loadFailures: { skillId: string; message: string }[] = [];
    private usage: RunUsage = emptyUsage();
    private resultSeen = false;
    private diagnostics: RunDiagnostics = {
        monotonicStartMs: Date.now(),
        wallStartIso: new Date().toISOString(),
        lastEvent: null,
        retries: [],
        heartbeats: [],
        interruption: {
            beganAtMs: null,
            beganAtIso: null,
            endedAtMs: null,
            endedAtIso: null,
            cleanupCompletedWithinBound: null,
        },
        timeoutClassification: {
            kind: null,
        },
    };

    constructor(init: RunReportInit, runId = createRunId()) {
        this.init = init;
        this.runId = runId;
        this.diagnostics.monotonicStartMs = this.startedAt;
        this.diagnostics.wallStartIso = this.startedAtIso;
    }

    /** Record a retry event from the SDK (api_retry). */
    recordRetry(event: Partial<SdkRetryEvent>): void {
        const nowMs = Date.now();
        this.diagnostics.retries.push({
            observedAtMs: nowMs,
            observedAtIso: new Date(nowMs).toISOString(),
            attempt: typeof event.attempt === "number" ? event.attempt : undefined,
            maxRetries: typeof event.maxRetries === "number" ? event.maxRetries : undefined,
            retryDelayMs: typeof event.retryDelayMs === "number" ? event.retryDelayMs : undefined,
            errorStatus:
                event.errorStatus === null || typeof event.errorStatus === "number"
                    ? event.errorStatus
                    : undefined,
            errorCategory: event.errorCategory ? redactSecrets(event.errorCategory) : undefined,
            retryAfterSeconds:
                event.retryAfterSeconds === null || typeof event.retryAfterSeconds === "number"
                    ? event.retryAfterSeconds
                    : undefined,
        });
        this.recordLastEvent("system", "api_retry");
    }

    /** Record a heartbeat while waiting for SDK events. */
    recordHeartbeat(): void {
        const nowMs = Date.now();
        this.diagnostics.heartbeats.push({
            observedAtMs: nowMs,
            observedAtIso: new Date(nowMs).toISOString(),
            elapsedMs: nowMs - this.diagnostics.monotonicStartMs,
        });
        this.recordLastEvent("heartbeat", undefined);
    }

    /** Record when interruption begins/ends. */
    recordInterruptionBegin(): void {
        if (this.diagnostics.interruption.beganAtMs == null) {
            const nowMs = Date.now();
            this.diagnostics.interruption.beganAtMs = nowMs;
            this.diagnostics.interruption.beganAtIso = new Date(nowMs).toISOString();
        }
    }

    recordInterruptionEnd(cleanupCompletedWithinBound?: boolean): void {
        if (this.diagnostics.interruption.endedAtMs == null) {
            const nowMs = Date.now();
            this.diagnostics.interruption.endedAtMs = nowMs;
            this.diagnostics.interruption.endedAtIso = new Date(nowMs).toISOString();
        }
        if (typeof cleanupCompletedWithinBound === "boolean") {
            this.diagnostics.interruption.cleanupCompletedWithinBound = cleanupCompletedWithinBound;
        }
    }

    setTimeoutClassification(kind: "deadline" | "cleanup", detail?: string): void {
        this.diagnostics.timeoutClassification = { kind, detail: detail ? redactSecrets(detail) : undefined };
    }

    private recordLastEvent(type: string, subtype?: string): void {
        const nowMs = Date.now();
        this.diagnostics.lastEvent = {
            type,
            subtype,
            observedAtMs: nowMs,
            observedAtIso: new Date(nowMs).toISOString(),
            elapsedMs: nowMs - this.diagnostics.monotonicStartMs,
        };
    }

    observe(message: SDKMessage): void {
        this.recordLastEvent(message.type, (message as { subtype?: string }).subtype);
        switch (message.type) {
            case "assistant":
                this.observeAssistant(message.message.content);
                return;
            case "user":
                this.observeToolResults(message.message.content);
                return;
            case "result":
                this.observeResult(message);
                return;
            default:
                return;
        }
    }

    finish(input: RunFinishInput): RunReport {
        // Be robust when the caller obtained the final result outside the
        // observe loop; usage and cost still come from the SDK result.
        if (input.result && !this.resultSeen) {
            this.observeResult(input.result);
        }

        const termination = classifyTermination({
            ...input,
            toolSummary: this.toolSummary(),
        });
        const finishedAt = Date.now();

        if (input.diagnostics) {
            if (input.diagnostics.retries) this.diagnostics.retries.push(...input.diagnostics.retries);
            if (input.diagnostics.heartbeats) this.diagnostics.heartbeats.push(...input.diagnostics.heartbeats);
            if (input.diagnostics.lastEvent) this.diagnostics.lastEvent = input.diagnostics.lastEvent;
            if (input.diagnostics.interruption) {
                this.diagnostics.interruption = { ...this.diagnostics.interruption, ...input.diagnostics.interruption };
            }
            if (input.diagnostics.timeoutClassification) {
                this.diagnostics.timeoutClassification = input.diagnostics.timeoutClassification;
            }
        }
        if (input.timedOut && !this.diagnostics.timeoutClassification.kind) {
            this.diagnostics.timeoutClassification = { kind: "deadline" };
        }

        return {
            schemaVersion: RUN_REPORT_SCHEMA_VERSION,
            runId: this.runId,
            startedAt: this.startedAtIso,
            finishedAt: new Date(finishedAt).toISOString(),
            elapsedMs: finishedAt - this.startedAt,
            cwd: this.init.cwd ?? process.cwd(),
            provider: "openrouter",
            model: this.init.model,
            mode: this.init.mode,
            prompt: {
                sha256: createHash("sha256").update(this.init.prompt).digest("hex"),
                length: this.init.prompt.length,
                preview: truncate(redactSecrets(this.init.prompt), PROMPT_PREVIEW_LIMIT),
            },
            skills: {
                candidates: [...this.init.selection.candidates],
                enabled: [...this.init.selection.enabled],
                recommended: [...this.init.selection.recommended],
                selected: [...this.init.selection.selected],
                available: [...this.init.availableSkills],
                loaded: [...this.loaded].sort(),
                requested: [...this.requested].sort(),
                retrievalCounts: Object.fromEntries(this.retrievalCounts),
                repeatedRetrievals: [...this.retrievalCounts.values()].reduce((sum, c) => sum + Math.max(0, c - 1), 0),
                loadFailures: [...this.loadFailures],
                consultedReferences: [...(this.init.consultedReferences ?? [])],
                selectedContextTokens: this.init.selection.selected.reduce(
                    (sum, id) => sum + skillTokenCost(id),
                    0,
                ),
                availableIndexTokens: this.init.availableSkills.reduce(
                    (sum, id) => sum + skillIndexTokenCost(id),
                    0,
                ),
                selectionVersion: this.init.selectionVersion ?? "unknown",
            },
            sdk: {
                tools: [...this.init.tools],
                permissionMode: this.init.permissionMode,
                maxTurns: this.init.maxTurns,
                maxBudgetUsd: this.init.maxBudgetUsd,
                mcpServers: [...this.init.mcpServers],
            },
            toolCalls: [...this.calls.values()].map((call) => ({ ...call })),
            toolSummary: this.toolSummary(),
            usage: this.usage,
            termination,
            diagnostics: this.diagnostics,
            resourceResolution: this.init.resourceResolution,
        };
    }

    getToolSummary(): RunReport["toolSummary"] {
        return this.toolSummary();
    }

    private observeAssistant(content: unknown): void {
        for (const block of contentBlocks(content)) {
            if (!isRecord(block) || block.type !== "tool_use") continue;
            const id = typeof block.id === "string" ? block.id : "";
            if (!id || this.calls.has(id) || this.calls.size >= MAX_TRACKED_TOOL_CALLS) continue;

            const name = typeof block.name === "string" ? block.name : "unknown";
            const input = isRecord(block.input) ? block.input : {};
            const useSkillId =
                isUseSkillTool(name) && typeof input.skillId === "string"
                    ? input.skillId
                    : undefined;

            if (useSkillId) {
                this.requested.add(useSkillId);
                this.retrievalCounts.set(useSkillId, (this.retrievalCounts.get(useSkillId) ?? 0) + 1);
            }

            this.calls.set(id, {
                id,
                name,
                input: summarizeInput(input),
                status: "pending",
                ...(useSkillId ? { useSkillId } : {}),
            });
        }
    }

    private observeToolResults(content: unknown): void {
        for (const block of contentBlocks(content)) {
            if (!isRecord(block) || block.type !== "tool_result") continue;
            const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
            if (!id) continue;

            const call = this.calls.get(id);
            if (!call || call.status !== "pending") continue;

            const failed = block.is_error === true;
            call.status = failed ? "failed" : "success";
            call.result = summarizeResult(block.content);

            if (call.useSkillId) {
                if (failed) {
                    this.loadFailures.push({
                        skillId: call.useSkillId,
                        message: call.result || "UseSkill returned an error.",
                    });
                } else {
                    this.loaded.add(call.useSkillId);
                }
            }
        }
    }

    private observeResult(message: Extract<SDKMessage, { type: "result" }>): void {
        if (this.resultSeen) return;
        this.resultSeen = true;

        const usage = message.usage as
            | {
                  input_tokens?: number;
                  output_tokens?: number;
                  cache_read_input_tokens?: number;
                  cache_creation_input_tokens?: number;
              }
            | undefined;

        const modelUsage: RunUsage["modelUsage"] = {};
        const rawModelUsage = (message as { modelUsage?: Record<string, unknown> }).modelUsage;
        if (isRecord(rawModelUsage)) {
            for (const [model, value] of Object.entries(rawModelUsage)) {
                if (!isRecord(value)) continue;
                modelUsage[model] = {
                    inputTokens: numberValue(value.inputTokens) || numberValue(value.input_tokens),
                    outputTokens: numberValue(value.outputTokens) || numberValue(value.output_tokens),
                    costUsd: numberValue(value.costUSD) || numberValue(value.costUsd),
                };
            }
        }

        this.usage = {
            inputTokens: numberValue(usage?.input_tokens),
            outputTokens: numberValue(usage?.output_tokens),
            cacheReadTokens: numberValue(usage?.cache_read_input_tokens),
            cacheCreationTokens: numberValue(usage?.cache_creation_input_tokens),
            costUsd: numberValue(message.total_cost_usd),
            turns: numberValue(message.num_turns),
            modelUsage,
        };
    }

    private toolSummary(): RunReport["toolSummary"] {
        const all = [...this.calls.values()];
        return {
            total: all.length,
            succeeded: all.filter((call) => call.status === "success").length,
            failed: all.filter((call) => call.status === "failed").length,
            pending: all.filter((call) => call.status === "pending").length,
            imageSearchCalls: all.filter((call) => call.name.endsWith("__ImageSearch")).length,
            useSkillCalls: all.filter((call) => isUseSkillTool(call.name)).length,
        };
    }
}

export type TerminationInput = RunFinishInput & {
    toolSummary?: RunReport["toolSummary"];
};

/**
 * Maps SDK results and local flags to one explicit termination reason. The
 * reason is deliberately independent from message text so tests and operators
 * can rely on it.
 */
export function classifyTermination(input: TerminationInput): RunReport["termination"] {
    if (input.cancelled) {
        return { reason: "cancelled", detail: "Cancelled by SIGINT.", exitCode: 1 };
    }
    if (input.timedOut) {
        return {
            reason: "timeout",
            detail: "The run exceeded its total time budget and was interrupted.",
            exitCode: 1,
        };
    }

    const result = input.result;
    if (!result) {
        if (input.error) {
            const failure = classifyProviderFailure(input.error);
            if (failure.kind === "budget") {
                return { reason: "budget_limit", detail: failure.message, exitCode: 1 };
            }
            return {
                reason: failure.kind === "unknown" ? "internal_error" : "provider_error",
                detail: redactSecrets(errorText(input.error)),
                exitCode: 1,
            };
        }
        return {
            reason: "incomplete",
            detail: "The stream ended without a result message.",
            exitCode: 1,
        };
    }

    if (result.subtype === "error_max_turns") {
        return { reason: "turn_limit", detail: resultDetail(result), exitCode: 1 };
    }
    if (result.subtype === "error_max_budget_usd") {
        return { reason: "budget_limit", detail: resultDetail(result), exitCode: 1 };
    }
    if (result.subtype === "error_max_structured_output_retries") {
        return { reason: "provider_error", detail: resultDetail(result), exitCode: 1 };
    }
    if (result.subtype === "error_during_execution") {
        const failure = classifyProviderFailure(new Error(resultDetail(result)));
        return {
            reason: failure.kind === "budget" ? "budget_limit" : "provider_error",
            detail: resultDetail(result),
            exitCode: 1,
        };
    }

    if (result.is_error) {
        const failure = classifyProviderFailure(new Error(resultDetail(result)));
        return {
            reason: failure.kind === "budget" ? "budget_limit" : "provider_error",
            detail: resultDetail(result),
            exitCode: 1,
        };
    }

    const summary = input.toolSummary;
    if (summary && summary.total > 0 && summary.succeeded === 0 && summary.failed > 0) {
        return {
            reason: "tool_failure",
            detail: "The model turn completed, but every observed tool call failed.",
            exitCode: 1,
        };
    }

    return {
        reason: "completed",
        detail: redactSecrets(successText(result) || "Run completed."),
        exitCode: 0,
    };
}

export function writeRunReport(
    report: RunReport,
    targetPath: string,
): { jsonPath: string; markdownPath: string } {
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(targetPath, JSON.stringify(report, null, 2) + "\n");

    const markdownPath = targetPath.replace(/\.json$/i, "") + ".md";
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, formatRunReport(report));

    return { jsonPath: targetPath, markdownPath };
}

export function defaultRunReportPath(runId: string): string {
    return join(process.env.NODE_CLI_HOME || join(homedir(), ".node-cli"), "runs", `${runId}.json`);
}

export function formatRunReport(report: RunReport): string {
    const skills = report.skills;
    const lines: string[] = [
        `# Node CLI run ${report.runId}`,
        "",
        `- Model: \`${report.model}\` (${report.provider})`,
        `- Mode: \`${report.mode}\``,
        `- Started: ${report.startedAt}`,
        `- Finished: ${report.finishedAt}`,
        `- Elapsed: ${report.elapsedMs} ms`,
        `- Termination: **${report.termination.reason}** (exit ${report.termination.exitCode})`,
        `- Detail: ${report.termination.detail}`,
        "",
        "## Skills",
        "",
        `- Selector: \`${skills.selectionVersion}\``,
        `- Candidates: ${list(skills.candidates)}`,
        `- Enabled: ${list(skills.enabled)}`,
        `- Recommended: ${list(skills.recommended)}`,
        `- Selected: ${list(skills.selected)}`,
        `- Available in prompt: ${list(skills.available)}`,
        `- Loaded by agent: ${list(skills.loaded)}
- Requested by model: ${list(skills.requested)}
- Repeated retrievals: ${skills.repeatedRetrievals}
- Retrieval counts: ${Object.entries(skills.retrievalCounts).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
        `- Load failures: ${skills.loadFailures.length === 0 ? "none" : skills.loadFailures.map((f) => `${f.skillId}: ${f.message}`).join("; ")}`,
        `- Selected body tokens (est.): ${skills.selectedContextTokens}`,
        `- Available index tokens (est.): ${skills.availableIndexTokens}`,
        "",
        "## Tools",
        "",
        `- Calls: ${report.toolSummary.total} (success ${report.toolSummary.succeeded}, failed ${report.toolSummary.failed}, pending ${report.toolSummary.pending})`,
        `- ImageSearch: ${report.toolSummary.imageSearchCalls}; UseSkill: ${report.toolSummary.useSkillCalls}`,
        "",
        "| Tool | Input | Status |",
        "|---|---|---|",
        ...report.toolCalls.map(
            (call) =>
                `| ${escapeCell(call.name)} | ${escapeCell(call.input || "-")} | ${call.status} |`,
        ),
        "",
        "## Usage",
        "",
        `- Turns: ${report.usage.turns}`,
        `- Input tokens: ${report.usage.inputTokens}`,
        `- Output tokens: ${report.usage.outputTokens}`,
        `- Cache read tokens: ${report.usage.cacheReadTokens}`,
        `- Cache creation tokens: ${report.usage.cacheCreationTokens}`,
        `- Estimated cost: $${report.usage.costUsd.toFixed(6)}`,
        "",
        `Prompt SHA-256: \`${report.prompt.sha256}\``,
        "",
    ];
    return lines.join("\n");
}

function emptyUsage(): RunUsage {
    return {
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        costUsd: 0,
        turns: 0,
        modelUsage: {},
    };
}

function contentBlocks(content: unknown): unknown[] {
    if (Array.isArray(content)) return content;
    if (isRecord(content) && Array.isArray(content.content)) return content.content;
    return [];
}

function isUseSkillTool(name: string): boolean {
    return name === "UseSkill" || name.endsWith("__UseSkill");
}

function summarizeInput(input: Record<string, unknown>): string {
    const candidate = ["command", "file_path", "pattern", "url", "query", "path", "skillId"].find(
        (key) => typeof input[key] === "string" && String(input[key]).trim(),
    );
    if (!candidate) return "";
    return truncate(redactSecrets(String(input[candidate])), TOOL_INPUT_LIMIT);
}

function summarizeResult(content: unknown): string {
    if (typeof content === "string") {
        return truncate(redactSecrets(content), TOOL_RESULT_LIMIT);
    }
    if (Array.isArray(content)) {
        const text = content
            .map((part) => (isRecord(part) && typeof part.text === "string" ? part.text : ""))
            .filter(Boolean)
            .join(" ");
        return truncate(redactSecrets(text), TOOL_RESULT_LIMIT);
    }
    return "";
}

function resultDetail(result: { subtype: string; errors?: string[]; result?: string }): string {
    const errors = (result.errors ?? []).filter(Boolean).join("; ");
    const text = errors || successText(result) || result.subtype;
    return truncate(redactSecrets(text), 600);
}

/** Reads the success payload without assuming it exists on error variants. */
function successText(result: object): string {
    const candidate = (result as { result?: unknown }).result;
    return typeof candidate === "string" ? candidate : "";
}

function errorText(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
}

function skillTokenCost(id: string): number {
    return getSkillInfo(id).contextTokens;
}

function skillIndexTokenCost(id: string): number {
    return Math.ceil(getSkillInfo(id).description.length / 4);
}

function numberValue(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function truncate(text: string, limit: number): string {
    const squashed = text.replace(/\s+/g, " ").trim();
    return squashed.length <= limit ? squashed : `${squashed.slice(0, limit - 3)}...`;
}

function list(values: string[]): string {
    return values.length === 0 ? "none" : values.join(", ");
}

function escapeCell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}
