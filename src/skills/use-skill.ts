import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { getActiveMode } from "../agent/active-mode.js";
import { isToolAllowed, toolSurface } from "../agent/modes.js";
import { loadSkillBody } from "./loader.js";
import { getSkillInfo, skillIndex } from "./registry.js";
import { confirmInTerminal } from "../ui/confirm.js";
import { printNotice, printFailure } from "../ui/messages.js";

const CONFIRMATION_REQUIRED_TOOLS = ["Edit", "Write", "Bash", "NotebookEdit", "UseSkill"];

export function createCanUseTool(): CanUseTool {
    return async (toolName, input) => {
        const mode = getActiveMode();

        if (!isToolAllowed(mode, toolName)) {
            return {
                behavior: "deny",
                message:
                    `Tool '${toolName}' is not allowed in '${mode}' mode. ` +
                    `Allowed tools: ${toolSurface(mode)}.`,
            };
        }

        if (mode === "agent" && CONFIRMATION_REQUIRED_TOOLS.includes(toolName)) {
            const detail =
                (typeof input.file_path === "string" && input.file_path) ||
                (typeof input.command === "string" && input.command) ||
                (typeof input.skillId === "string" && input.skillId) ||
                (typeof input.pattern === "string" && input.pattern) ||
                "";
            const question = `Allow '${toolName}${detail ? ` (${detail})` : ""}'? [y/N]`;
            const approved = await confirmInTerminal(question);
            if (!approved) {
                return {
                    behavior: "deny",
                    message: `The user declined '${toolName}'. Ask before trying again.`,
                };
            }
        }

        return { behavior: "allow" };
    };
}

function isUseSkillTool(toolName: string): boolean {
    return toolName === "UseSkill" || toolName.endsWith("__UseSkill");
}

export type SkillActivationResult = {
    ok: boolean;
    body: string | null;
    message: string;
};

export function activateSkill(skillId: string): SkillActivationResult {
    const info = getSkillInfo(skillId);
    if (info.availability !== "available") {
        const message = info.reason ?? `Skill '${skillId}' is unavailable.`;
        printFailure(message);
        return { ok: false, body: null, message };
    }

    const skill = loadSkillBody(skillId);
    if (!skill) {
        const message =
            `Skill '${skillId}' is listed as available but its SKILL.md could not be read. ` +
            "Reinstall it or choose another skill.";
        printFailure(message);
        return { ok: false, body: null, message };
    }

    printNotice(`Skill activated: ${skillId}`);
    return { ok: true, body: skill.body, message: `Skill activated: ${skillId}` };
}

export function createUseSkillTool(): CanUseTool {
    return async (toolName, input) => {
        if (!isUseSkillTool(toolName)) {
            return { behavior: "allow" };
        }

        const skillId = typeof input.skillId === "string" ? input.skillId : "";
        if (!skillId) {
            return {
                behavior: "deny",
                message: "UseSkill requires a skillId parameter.",
            };
        }

        const info = getSkillInfo(skillId);
        if (info.availability !== "available") {
            return {
                behavior: "deny",
                message: info.reason ?? `Skill '${skillId}' is unavailable.`,
            };
        }

        const mode = getActiveMode();
        if (mode === "agent") {
            const approved = await confirmInTerminal(
                `Allow 'UseSkill' (${skillId})? [y/N]`
            );
            if (!approved) {
                return {
                    behavior: "deny",
                    message: `The user declined 'UseSkill'. Ask before trying again.`,
                };
            }
        }

        const activation = activateSkill(skillId);
        if (!activation.ok) {
            return {
                behavior: "deny",
                message: activation.message,
            };
        }

        return { behavior: "allow" };
    };
}

export function skillEnabledError(skillId: string, enabledSkills?: string[]): string | null {
    if (!enabledSkills) return null;
    if (enabledSkills.includes(skillId)) return null;
    return (
        `Skill '${skillId}' is installed but not enabled for this session. ` +
        "Enable it with /skills; do not activate disabled skills."
    );
}

export function createUseSkillMcpServer(enabledSkills?: string[]) {
    const failedActivations = new Set<string>();

    return createSdkMcpServer({
        name: "node-cli",
        version: "1.0.0",
        tools: [
            tool(
                "UseSkill",
                "Activate a skill and receive its full instructions.",
                { skillId: z.string() },
                async ({ skillId }) => {
                    const disabled = skillEnabledError(skillId, enabledSkills);
                    if (disabled) {
                        printFailure(disabled);
                        return {
                            content: [{ type: "text" as const, text: disabled }],
                            isError: true,
                        };
                    }

                    if (failedActivations.has(skillId)) {
                        const message =
                            `Skill '${skillId}' already failed to activate in this session. ` +
                            "Do not retry it; choose an available skill or proceed without it.";
                        printFailure(message);
                        return {
                            content: [{ type: "text" as const, text: message }],
                            isError: true,
                        };
                    }

                    const activation = activateSkill(skillId);
                    if (!activation.ok || !activation.body) {
                        failedActivations.add(skillId);
                        return {
                            content: [{ type: "text" as const, text: activation.message }],
                            isError: true,
                        };
                    }
                    return {
                        content: [{ type: "text" as const, text: activation.body }],
                    };
                },
            ),
        ],
    });
}

export const createSkillMcpServer = createUseSkillMcpServer;
export const createSkillServer = createUseSkillMcpServer;

export function buildSkillIndex(skillIds: string[]): string {
    const index = skillIndex(skillIds);
    if (index.length === 0) {
        return "No skills enabled.";
    }

    let lines = "Enabled skills (index only — full bodies loaded on activation):\n";
    for (const entry of index) {
        lines += `- ${entry.id}: ${entry.description} (~${entry.contextTokens} tokens)\n`;
    }
    return lines;
}
