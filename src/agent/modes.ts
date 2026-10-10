import type { Options, PermissionMode } from "@anthropic-ai/claude-agent-sdk";


export type Climode = "agent" | "ask" | "plan";


const READ_TOOLS = ['Read', 'Grep', 'Glob', 'WebSearch', "WebFetch"] as const;
const AGENT_TOOLS = ['Read', "Edit", "Write", "Bash", "Glob", "Grep"] as const;
const BLOCED_WRITE_TOOLS = ["Edit", "Write", "Bash"] as const;

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
    maxTurns: 25,
    maxBudgetUsd: 1.0,
    effort: 'medium' as const,
    settingSources: ['project'] as Options['settingSources']
}

export function buildModeOptions(mode: Climode): Options {
    switch (mode) {
        case "agent":
            return {
                ...BASE_OPTIONS,
                permissionMode: "acceptEdits" satisfies PermissionMode,
                allowedTools: [...AGENT_TOOLS]
            }
        case "ask":
            return {
                ...BASE_OPTIONS,
                permissionMode: "dontAsk" satisfies PermissionMode,
                allowedTools: [...READ_TOOLS],
                disallowedTools: [...BLOCED_WRITE_TOOLS]
            }
        case "plan":
            return {
                ...BASE_OPTIONS,
                permissionMode: "plan" satisfies PermissionMode,
                allowedTools: [...READ_TOOLS],
                disallowedTools: [...BLOCED_WRITE_TOOLS]
            }
    }
}


export function CliModeToPermissionMode(mode: Climode): PermissionMode {
    switch (mode) {
        case "agent":
            return "acceptEdits"
        case "ask":
            return "dontAsk"
        case "plan":
            return "plan"
    }
}

export function parseCliMode(value: string): Climode | null {
    if (value === "agent" || value === "ask" || value === "plan") {
        return value
    }
    return null
}
