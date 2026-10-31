import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { redactForDiagnostics, redactSecrets } from "../security/redact.js";
import { writeLine } from "../ui/output-buffer.js";
import { stopSpinner } from "../ui/spinner.js";
import { style, truncate } from "../ui/styles.js";

export type PrintOptions = {
    verbose?: boolean;
};

const TOOL_INPUT_LABEL = 80;
const TOOL_RESULT_LIMIT = 300;
const TOOL_ERROR_LIMIT = 80;

let lastAnswer = "";

export function printMessage(message: SDKMessage, options: PrintOptions = {}): void {
    const { verbose = false } = options;

    if (verbose) {
        writeLine(style.dim(`[${message.type}]`));
    }

    switch (message.type) {
        case "system":
            printSystemMessage(message);
            return;
        case "assistant":
            printAssistantMessage(message);
            return;
        case "user":
            printToolResults(message);
            return;
        case "stream_event":
            if (verbose) {
                writeLine(style.dim("(streaming...)"));
            }
            return;
        case "result":
            printResultMessage(message);
            return;
        default:
            if (verbose) {
                writeLine(style.dim(redactForDiagnostics(message)));
            }
    }
}

function printSystemMessage(message: Extract<SDKMessage, { type: "system" }>): void {
    if (message.subtype === "api_retry") {
        const retry = message as unknown as {
            attempt?: number;
            max_retries?: number;
            retry_delay_ms?: number;
            error_status?: number | null;
        };
        const attempt = retry.attempt ?? 1;
        const maximum = retry.max_retries ?? 1;
        const delay = Math.max(0, Math.round((retry.retry_delay_ms ?? 0) / 1000));
        const status = retry.error_status ? `HTTP ${retry.error_status}` : "connection error";
        writeLine(
            style.warning(
                `Provider retry ${attempt}/${maximum} in ${delay}s (${status}); waiting rather than repeating the request.`,
            ),
        );
        return;
    }

    if (message.subtype !== "init") {
        return;
    }
    writeLine(
        style.dim(`Session started · model ${message.model} · id ${message.session_id}`),
    );
}

function printAssistantMessage(message: Extract<SDKMessage, { type: "assistant" }>): void {
    const { text, toolCalls } = readAssistantContent(message.message.content);

    if (text.trim()) {
        lastAnswer = text.trim();
        writeLine(style.agent(redactSecrets(lastAnswer)));
    }

    for (const toolCall of toolCalls) {
        const detail = summarizeToolInput(toolCall.input);
        writeLine(style.tool(`→ ${toolCall.name}${detail ? `: ${detail}` : ""}`));
    }
}

function printToolResults(message: Extract<SDKMessage, { type: "user" }>): void {
    for (const block of readToolResultBlocks(message.message.content)) {
        if (!block.result.trim()) {
            continue;
        }

        if (block.failed) {
            writeLine(style.error(`Tool failed: ${firstLine(redactSecrets(block.result), TOOL_ERROR_LIMIT)}`));
            continue;
        }

        writeLine(
            style.toolResult(truncate(redactSecrets(block.result.trim()), TOOL_RESULT_LIMIT)),
        );
    }
}

function printResultMessage(message: Extract<SDKMessage, { type: "result" }>): void {
    stopSpinner();

    if (message.subtype !== "success") {
        writeLine(style.error(`Failed: ${redactSecrets(message.errors?.join(", ") ?? message.subtype)}`));
        return;
    }

    const summary = message.result?.trim() ?? "";
    if (summary && summary !== lastAnswer) {
        writeLine(style.agent(redactSecrets(summary)));
    }

    writeLine(style.success(`Done · ${turnCount(message.num_turns)} · $${message.total_cost_usd.toFixed(6)}`));
}

type AssistantContent = {
    text: string;
    toolCalls: { name: string; input: unknown }[];
};

type ToolResultBlock = {
    result: string;
    failed: boolean;
};

function readAssistantContent(content: unknown): AssistantContent {
    if (typeof content === "string") {
        return { text: content, toolCalls: [] };
    }

    const blocks = Array.isArray(content) ? content : [];

    return {
        text: blocks
            .filter(isTextBlock)
            .map((block) => block.text)
            .join(""),
        toolCalls: blocks
            .filter(isToolUseBlock)
            .map((block) => ({ name: block.name, input: block.input })),
    };
}

function readToolResultBlocks(content: unknown): ToolResultBlock[] {
    const blocks = Array.isArray(content) ? content : [];

    return blocks.filter(isToolResultBlock).map((block) => ({
        result: typeof block.content === "string" ? block.content : "",
        failed: block.is_error === true,
    }));
}

function summarizeToolInput(input: unknown): string {
    if (!input || typeof input !== "object") {
        return "";
    }

    const record = input as Record<string, unknown>;
    const candidate = ["command", "file_path", "pattern", "url", "query", "path"].find(
        (key) => typeof record[key] === "string" && String(record[key]).trim(),
    );

    return candidate ? truncate(squashWhitespace(String(record[candidate])), TOOL_INPUT_LABEL) : "";
}

function turnCount(turns: number): string {
    return `${turns} ${turns === 1 ? "turn" : "turns"}`;
}

function firstLine(text: string, limit: number): string {
    const line = text.split("\n").find((candidate) => candidate.trim());
    return line ? truncate(line.trim(), limit) : "";
}

function squashWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function isTextBlock(block: unknown): block is { type: "text"; text: string } {
    return isRecord(block) && block.type === "text";
}

function isToolUseBlock(block: unknown): block is { type: "tool_use"; name: string; input: unknown } {
    return isRecord(block) && block.type === "tool_use";
}

function isToolResultBlock(
    block: unknown,
): block is { type: "tool_result"; content: unknown; is_error?: boolean } {
    return isRecord(block) && block.type === "tool_result";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}