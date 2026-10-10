import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Climode } from "./modes.ts";

const BLOCKED_WRITE_TOOLS = ["Edit", "Write", "Bash"];

export function createCanUseTool(getMode: () => Climode): CanUseTool {
    return async (toolName) => {
        const mode = getMode();
        if ((mode === "ask" || mode === "plan") && BLOCKED_WRITE_TOOLS.includes(toolName)) {
            return {
                behavior: "deny" as const,
                message: `Tool '${toolName}' is disallowed in '${mode}' mode.`
            };
        }
        return {
            behavior: "allow" as const
        };
    };
}