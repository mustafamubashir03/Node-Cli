import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { getCurrentMode, isToolAllowedInMode, MODES } from "./modes.js";
import { resumeSpinner, suspendSpinner } from "../ui/spinner.js";
import { pauseOutput, resumeOutput } from "./message-handler.js";

const CONFIRM_TOOLS = ["Edit", "Write", "Bash", "NotebookEdit"];

let queue: Promise<unknown> = Promise.resolve();
let waiting = 0;

function askOnce<T>(ask: () => Promise<T>): Promise<T> {
    const started = waiting === 0 ? ask() : queue.then(ask, ask);
    waiting++;
    return started.finally(() => {
        waiting--;
        queue = Promise.resolve();
    });
}

async function confirmWithUser(toolName: string, input: Record<string, unknown>): Promise<boolean> {
    const detail =
        (typeof input.file_path === "string" && input.file_path) ||
        (typeof input.command === "string" && input.command) ||
        (typeof input.pattern === "string" && input.pattern) ||
        "";

    suspendSpinner();
    pauseOutput();
    process.stdout.write(`\nAllow '${toolName}${detail ? ` (${detail})` : ""}'? [y/N] `);

    return new Promise<boolean>((resolve) => {
        const stdin = process.stdin;
        stdin.resume();
        const cleanup = () => {
            stdin.removeListener("data", onData);
            stdin.removeListener("end", onEnd);
            stdin.removeListener("error", onError);
            stdin.pause();
        };
        const settle = (allowed: boolean) => {
            cleanup();
            process.stdout.write("\n");
            resumeSpinner();
            resumeOutput();
            resolve(allowed);
        };
        function onData(chunk: Buffer) {
            const answer = chunk.toString().trim().toLowerCase();
            settle(answer === "y" || answer === "yes");
        }
        function onEnd() {
            settle(false);
        }
        function onError() {
            settle(false);
        }

        stdin.on("data", onData);
        stdin.once("end", onEnd);
        stdin.once("error", onError);
    });
}

export function createCanUseTool(): CanUseTool {
    return async (toolName, input) => {
        const mode = getCurrentMode();

        if (!isToolAllowedInMode(mode, toolName)) {
            return {
                behavior: "deny" as const,
                message:
                    `Tool '${toolName}' is not allowed in '${mode}' mode. ` +
                    `Allowed tools: ${MODES[mode].tools.join(", ")}.`,
            };
        }

        if (mode === "agent" && CONFIRM_TOOLS.includes(toolName)) {
            const allowed = await askOnce(() => confirmWithUser(toolName, input));
            if (!allowed) {
                return {
                    behavior: "deny" as const,
                    message: `The user declined '${toolName}'. Ask before trying again.`,
                };
            }
        }

        return { behavior: "allow" as const };
    };
}