import type { HookCallback, Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";

export type Climode = "agent" | "ask" | "plan";

const READ_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"] as const;
// Agent is deliberately the union of READ_TOOLS plus the write tools. The SDK
// fixes a query's tool list at initialisation, so only a superset relationship
// lets agent -> ask/plan reuse the live query instead of restarting it.
const AGENT_TOOLS = [...READ_TOOLS, "Edit", "Write", "Bash"] as const;

/**
 * Irrelevant built-ins. These are removed from the prompt entirely (via `tools`)
 * AND denied by name, as a second layer of defence.
 */
const NEVER_TOOLS = [
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
] as const;

const READ_ONLY_PROMPT =
    "Read only what is needed. Answer or propose a short plan. " +
    "Never spawn subagents, schedule tasks, or run shell commands.";

const AGENT_PROMPT = "Be efficient. Make the smallest change that solves the task.";

/**
 * Single source of truth for every mode. buildModeOptions, the permission-mode
 * mapping, the picker choices and the help text are all derived from this.
 */
export const MODES = {
    agent: {
        tools: [...AGENT_TOOLS],
        // Must stay "default": the SDK defines 'acceptEdits' as "Auto-accept file
        // edit operations" and documents 'default' as the mode that "keeps manual
        // approvals through canUseTool" (sdk.d.ts Options.permissionMode). Under
        // 'acceptEdits' the Edit confirmation in permissions.ts would never fire.
        permissionMode: "default",
        maxTurns: 25,
        prompt: AGENT_PROMPT,
        description: "Read, edit, and run commands - full agent loop with tools",
    },
    ask: {
        tools: [...READ_TOOLS],
        permissionMode: "dontAsk",
        maxTurns: 6,
        prompt: READ_ONLY_PROMPT,
        description: "Read-only exploration, answer without changing the files",
    },
    plan: {
        tools: [...READ_TOOLS],
        permissionMode: "plan",
        maxTurns: 6,
        prompt: READ_ONLY_PROMPT,
        description: "Explore and propose a plan. No file edits applied. Think first, then execute as agent",
    },
} as const satisfies Record<Climode, {
    tools: string[];
    permissionMode: PermissionMode;
    maxTurns: number;
    prompt: string;
    description: string;
}>;

export const CLI_MODES = Object.keys(MODES) as Climode[];

export const MODE_DESCRIPTIONS: Record<Climode, string> = Object.fromEntries(
    CLI_MODES.map((mode) => [mode, MODES[mode].description]),
) as Record<Climode, string>;

const MODEL = process.env.AGENT_MODEL ?? "poolside/laguna-s-2.1:free";
const SMALL_MODEL = "poolside/laguna-xs-2.1:free";

const BASE_OPTIONS = {
    model: MODEL,
    env: {
        ...process.env,
        ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
        ANTHROPIC_AUTH_TOKEN: process.env.OPENROUTER_API_KEY,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_DEFAULT_SONNET_MODEL: MODEL,
        ANTHROPIC_DEFAULT_OPUS_MODEL: MODEL,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: SMALL_MODEL,
    },
    maxBudgetUsd: 1.0,
    effort: "medium" as const,
    // Isolation mode: no user/project settings, CLAUDE.md, skills or hooks from
    // disk can inject allow rules, extra tools or instructions over our config.
    settingSources: [] as Options["settingSources"],
    // No skills unless explicitly enabled - they cost context on every request.
    skills: [],
};

/**
 * Tools visible to the model for the given mode. `tools` (not `allowedTools`)
 * is what shrinks the prompt, because it removes the definitions entirely.
 */
export function buildModeOptions(mode: Climode): Options {
    const config = MODES[mode];
    return {
        ...BASE_OPTIONS,
        tools: config.tools,
        disallowedTools: [...NEVER_TOOLS],
        permissionMode: config.permissionMode satisfies PermissionMode,
        maxTurns: config.maxTurns,
        systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: config.prompt,
        },
    };
}

export function CliModeToPermissionMode(mode: Climode): PermissionMode {
    return MODES[mode].permissionMode;
}

/**
 * Module-level live mode. `tools` is fixed when the query starts and cannot be
 * changed mid-session, so the runtime hook and canUseTool both read this instead.
 */
let currentMode: Climode = "agent";

export function getCurrentMode(): Climode {
    return currentMode;
}

export function setCurrentMode(mode: Climode): void {
    currentMode = mode;
}

export function isToolAllowedInMode(mode: Climode, toolName: string): boolean {
    return (MODES[mode].tools as readonly string[]).includes(toolName);
}

/**
 * Runtime enforcement. PreToolUse is the only gate that is guaranteed to run for
 * every tool call - bare `allowedTools` entries and settings allow-rules can both
 * shadow `canUseTool`, whereas this hook cannot be shadowed.
 */
export function createModeGuardHook(): HookCallback {
    return async (input) => {
        if (input.hook_event_name !== "PreToolUse") {
            return {};
        }
        const mode = getCurrentMode();
        const toolName = input.tool_name;
        if (isToolAllowedInMode(mode, toolName)) {
            return {};
        }
        const allowed = MODES[mode].tools.join(", ");
        return {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny" as const,
                permissionDecisionReason:
                    `'${toolName}' is not available in '${mode}' mode. ` +
                    `Only these tools are allowed in '${mode}' mode: ${allowed}. ` +
                    (mode === "agent"
                        ? ""
                        : `Switch to agent mode with /mode agent to make changes.`),
            },
        };
    };
}

export function parseCliMode(value: string): Climode | null {
    if (value === "agent" || value === "ask" || value === "plan") {
        return value;
    }
    return null;
}