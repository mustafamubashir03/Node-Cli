import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { fmt, truncate } from "../ui/format.ts"
import { stopSpinner } from "../ui/spinner.ts";


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

function extractToolNames(content: unknown): string[] {
    if (!Array.isArray(content)) {
        return [];
    }
    return content.filter((block): block is { type: "tool_use", name: string } => block?.type === "tool_use").map(block => block.name)

}

export interface MessageHandlerOptions {
    verbose?: boolean;
}

export function handleMessage(message: SDKMessage, options: MessageHandlerOptions = {}): void {
    const { verbose = false } = options;
    if (verbose) {
        console.log(fmt.dim(`[${message.type}]`))
    }
    switch (message.type) {
        case "system":
            if (message.subtype == "init") {
                fmt.system(`Session started . Model: ${message.model} . id:`)

            }

            break;
        case "assistant":
            const content = message.message.content;
            const text = contentToString(content)
            const toolNames = extractToolNames(content)
            if (text.trim()) {
                console.log(fmt.assistant(text.trim()))
            }
            for (const toolName of toolNames) {
                console.log(fmt.tool(` -> ${toolName}`))
            }
            break


            break;
        case "user":
            if (message.parent_tool_use_id) {
                const result = contentToString(message.message.content)
                if (result) {
                    console.log(fmt.toolResult(`\n${result.trim()}`))
                }
            }
            break;
        case "stream_event":
            if (verbose) {
                console.log(fmt.dim("(streaming...)"))
            }
            break;
        case "result":
            stopSpinner()
            if (message.subtype === "success") {
                if (message.result?.trim()) {
                    console.log(fmt.success("\n" + message.result.trim()))
                }
                console.log(fmt.success(`Done . ${message.num_turns} turns . ${message.total_cost_usd.toFixed(6)} cost`))
            }
            else {
                console.log(fmt.error(`Failed . ${message.errors?.join(", ")}`))
            }
            break;
        default:
            if (verbose) {
                console.log(fmt.dim(JSON.stringify(message, null, 2)));
            }
            break;


    }
}