import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { fmt, truncate } from "../ui/format.js"
import { stopSpinner } from "../ui/spinner.js";


function contentToString(content: unknown): string {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
        return content.map(chunk => {
            if (typeof chunk === "string") return chunk;
            if (chunk?.type === "tool_use") {
                return `\n${fmt.tool(chunk.name)}`
            }
            return ""
        }).filter(Boolean).join("")
    }
    return ""
}

/** Short, human-readable summary of a tool's input - never a full dump. */
function summarizeToolInput(name: string, input: unknown): string {
    if (!input || typeof input !== "object") {
        return "";
    }
    const record = input as Record<string, unknown>;
    const candidates = [
        record.command,
        record.file_path,
        record.pattern,
        record.url,
        record.query,
        record.notebook_path,
        record.path,
    ];
    for (const candidate of candidates) {
        if (typeof candidate === "string" && candidate.trim()) {
            return truncate(candidate.replace(/\s+/g, " ").trim(), 80);
        }
    }
    return "";
}

function extractToolCalls(content: unknown): { name: string; input: unknown }[] {
    if (!Array.isArray(content)) {
        return [];
    }
    return content
        .filter((block): block is { type: "tool_use"; name: string; input: unknown } => block?.type === "tool_use")
        .map(block => ({ name: block.name, input: block.input }));
}

export interface MessageHandlerOptions {
    verbose?: boolean;
}

/*
 * The SDK keeps streaming messages while a permission request is outstanding, so
 * tool notifications used to land on top of the approval prompt. Buffer them
 * until the prompt is answered.
 */
let held: string[] | null = null;

export function pauseOutput(): void {
    held ??= [];
}

export function resumeOutput(): void {
    const pending = held;
    held = null;
    for (const line of pending ?? []) console.log(line);
}

function emit(line: string): void {
    if (held) held.push(line);
    else console.log(line);
}

export function handleMessage(message: SDKMessage, options: MessageHandlerOptions = {}): void {
    const { verbose = false } = options;
    if (verbose) {
        emit(fmt.dim(`[${message.type}]`))
    }
    switch (message.type) {
        case "system":
            if (message.subtype == "init") {
                emit(fmt.system(`Session started . Model: ${message.model} . id:`))

            }

            break;
        case "assistant":
            const content = message.message.content;
            const text = contentToString(content)
            const toolCalls = extractToolCalls(content)
            if (text.trim()) {
                emit(fmt.assistant(text.trim()))
            }
            for (const call of toolCalls) {
                const summary = summarizeToolInput(call.name, call.input);
                emit(fmt.tool(` -> ${call.name}${summary ? `: ${summary}` : ""}`))
            }
            break

            break;
        case "user":
            // Tool results arrive as `user` messages with parent_tool_use_id set to
            // null, so they are identified by their content block instead.
            const blocks = Array.isArray(message.message.content) ? message.message.content : [];
            for (const block of blocks as { type?: string; is_error?: boolean; content?: unknown }[]) {
                if (block?.type !== "tool_result") continue;
                const result = typeof block.content === "string" ? block.content : "";
                if (!result) continue;
                const firstLine = result.split("\n").find(line => line.trim());
                const summary = firstLine ? truncate(firstLine.trim(), 80) : "";
                if (block.is_error) {
                    emit(fmt.error(`Tool failed: ${summary}`));
                } else {
                    emit(fmt.toolResult(`\n${truncate(result.trim(), 300)}`));
                }
            }
            break;
        case "stream_event":
            if (verbose) {
                emit(fmt.dim("(streaming...)"))
            }
            break;
        case "result":
            stopSpinner()
            if (message.subtype === "success") {
                if (message.result?.trim()) {
                    emit(fmt.success("\n" + message.result.trim()))
                }
                emit(fmt.success(`Done . ${message.num_turns} turns . ${message.total_cost_usd.toFixed(6)} cost`))
            }
            else {
                emit(fmt.error(`Failed . ${message.errors?.join(", ")}`))
            }
            break;
        default:
            if (verbose) {
                emit(fmt.dim(JSON.stringify(message, null, 2)));
            }
            break;


    }
}