import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk";

export type Mode = "agent" | "ask" | "plan" | "strict";

export type ModeConfig = {
    tools: readonly string[];
    permissionMode: PermissionMode;
    maxTurns: number;
    instruction: string;
    description: string;
    /**
     * Strict mode requires an approval for operations that the standard
     * (agent) policy would auto-allow, such as routine in-project writes and
     * low-risk shell commands. Security boundaries stay enforced either way.
     */
    strict?: boolean;
};

const READ_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"] as const;
const WRITE_TOOLS = ["Edit", "Write", "Bash"] as const;
const AGENT_TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

export const TOOLS_DISABLED_IN_EVERY_MODE = [
    "Agent",
    "Task",
    "SendMessage",
    "ScheduleWakeup",
    "CronCreate",
    "CronDelete",
    "CronList",
    "TodoWrite",
    "NotebookEdit",
    "Skill",
    "SlashCommand",
    "ExitPlanMode",
    "KillShell",
    "BashOutput",
];

const READ_ONLY_INSTRUCTION =
    "Read only what is needed. Answer or propose a short plan. " +
    "Never spawn subagents, schedule tasks, or run shell commands.";

const AGENT_INSTRUCTION = "Be efficient. Make the smallest change that solves the task.";

export const MODES: Record<Mode, ModeConfig> = {
    agent: {
        tools: AGENT_TOOLS,
        // Auto-accept routine file edits (Write/Edit) so the SDK does not ask
        // for every in-project edit; the CLI permission policy still gates
        // Bash and out-of-project targets.
        permissionMode: "acceptEdits",
        maxTurns: 25,
        instruction: AGENT_INSTRUCTION,
        description: "Read, edit, and run commands - full agent loop with tools",
    },
    strict: {
        tools: AGENT_TOOLS,
        permissionMode: "default",
        maxTurns: 25,
        instruction: AGENT_INSTRUCTION,
        description: "Read, edit, and run commands - every write and command needs approval",
        strict: true,
    },
    ask: {
        tools: READ_TOOLS,
        permissionMode: "dontAsk",
        maxTurns: 6,
        instruction: READ_ONLY_INSTRUCTION,
        description: "Read-only exploration, answer without changing the files",
    },
    plan: {
        tools: READ_TOOLS,
        permissionMode: "plan",
        maxTurns: 6,
        instruction: READ_ONLY_INSTRUCTION,
        description: "Explore and propose a plan. No file edits applied. Think first, then execute as agent",
    },
};

export const ALL_MODES = Object.keys(MODES) as Mode[];

export function parseMode(value: string): Mode | null {
    return ALL_MODES.includes(value as Mode) ? (value as Mode) : null;
}

export function toPermissionMode(mode: Mode): PermissionMode {
    return MODES[mode].permissionMode;
}

export function isToolAllowed(mode: Mode, toolName: string): boolean {
    if (toolName === "UseSkill" || toolName === "mcp__node-cli__UseSkill") {
        return true;
    }
    if (toolName.startsWith("mcp__node-cli-images__")) {
        return true;
    }
    if (toolName.startsWith("mcp__node-cli-figma__")) {
        return true;
    }
    return MODES[mode].tools.includes(toolName);
}

export function toolSurface(mode: Mode): string {
    return MODES[mode].tools.join(", ");
}