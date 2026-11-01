import type { Options } from "@anthropic-ai/claude-agent-sdk";
import { createCanUseTool, createModeGuardHook } from "./permissions.js";
import { createUseSkillMcpServer } from "../skills/use-skill.js";
import { createImageMcpServer } from "../images/image-mcp.js";
import { createFigmaMcpServer } from "../figma/mcp-server.js";
import { MODES, TOOLS_DISABLED_IN_EVERY_MODE, toPermissionMode, type Mode } from "./modes.js";
import {
    FAST_MODEL,
    maxBudgetUsd,
    OPENROUTER_BASE_URL,
    REASONING_EFFORT,
    primaryModel,
} from "../config/models.js";
import { requireCredentials } from "../config/env.js";
import { skillIndex } from "../skills/registry.js";
import { loadMemoryContext } from "../memory/memory.js";
import { existsSync, readFileSync } from "node:fs";
import { buildDesignAnchor } from "../figma/design-anchor.js";
import { join } from "node:path";

export function buildSdkOptions(mode: Mode, sessionSkills: string[] = []): Options {
    const config = MODES[mode];
    const model = primaryModel();

    return {
        model,
        tools: [...config.tools],
        disallowedTools: [...TOOLS_DISABLED_IN_EVERY_MODE],
        permissionMode: toPermissionMode(mode),
        maxTurns: config.maxTurns,
        systemPrompt: {
            type: "preset",
            preset: "claude_code",
            append: buildSystemAppend(config.instruction, sessionSkills),
        },
        env: buildSubprocessEnvironment(model),
        maxBudgetUsd: maxBudgetUsd(),
        effort: REASONING_EFFORT,
        settingSources: [],
        // The SDK's `skills` option preloads Claude Code skills by name
        // (e.g. "pdf", "docx"). Our ids are local catalog ids that are served
        // by the node-cli MCP server instead, so they must not be sent here.
        skills: [],
    };
}

export function buildInteractiveSdkOptions(
    mode: Mode,
    sessionSkills: string[],
    resumeSessionId?: string,
    fidelityMode?: boolean
): Options {
    const options = buildSdkOptions(mode, sessionSkills);

    // Build design anchor block for fidelity mode
    let designAnchor = "";
    if (fidelityMode) {
        const figmaDir = join(process.cwd(), ".node-cli", "figma");
        const hasFigmaPackage = existsSync(figmaDir);

        // Load manifest if it exists
        let manifestInfo = "";
        const manifestPath = join(figmaDir, "MANIFEST.lock.json");
        if (existsSync(manifestPath)) {
            try {
                const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
                const files = Object.keys(manifest.files || {});
                const lastModified = manifest.lastModified || "unknown";
                const buildHash = manifest.buildHash || "unknown";
                manifestInfo = `\n- Package path: ${figmaDir}\n- Manifest version: ${manifest.version || "1"}\n- Last modified: ${lastModified}\n- Build hash: ${buildHash}\n- Files: ${files.join(", ")}`;
            } catch {
                manifestInfo = `\n- Package path: ${figmaDir} (manifest read error)`;
            }
        } else {
            manifestInfo = `\n- Package path: ${figmaDir} (no MANIFEST.lock.json)`;
        }

        designAnchor = `## FIDELITY MODE DESIGN ANCHOR

You are working with a Figma design package. This is the only source of truth for this session.

${manifestInfo}

Design rules:
- The Figma package is the only source of truth. Your previous output is not a reference.
- Do not guess values. Use only assets from assets.json.
- Do not reference images, colors, or dimensions outside the design package.
- All images must reference manifest paths from assets.json.
- No hotlinked URLs, no CDN, no external image sources.
- Placeholders must be labeled with status: approximate if generated.

Section status: Focus on one section at a time. Each section has its own spec.md.

Skill selection in fidelity mode:
- Mandatory skills: figma-to-code, fidelity-rules
- Excluded skills in fidelity mode: impeccable, no-ai-slop, apple-design, emil-design-eng, theme-factory
- The creative parts of frontend-design are also excluded in fidelity mode
- Only design-relevant skills should be activated;

Focus on implementing one section at a time using only the design package assets. Never invent copy, colors, or imagery.

`;
    }

    const interactiveOptions: Options = {
        ...options,
        tools: [...(options.tools as string[]), "UseSkill"],
        canUseTool: createCanUseTool(),
        mcpServers: { "node-cli": createUseSkillMcpServer(sessionSkills), "node-cli-images": createImageMcpServer(), "node-cli-figma": createFigmaMcpServer() },
        hooks: { PreToolUse: [{ hooks: [createModeGuardHook()] }] },
    };

    if (resumeSessionId) {
        interactiveOptions.resume = resumeSessionId;

        // Also prepend design anchor on resume
        if (!designAnchor && existsSync(join(process.cwd(), ".node-cli", "figma"))) {
            designAnchor = "## FIDELITY MODE - Resumed Session\nThe design package is still active. Follow the same fidelity mode rules as above.\n";
        }
    }

    return interactiveOptions;
}

function buildSystemAppend(instruction: string, skillIds: string[], designAnchor?: string): string {
    // Prepend design anchor block if in fidelity mode
    let result = instruction;
    if (designAnchor) {
        result = designAnchor + "\n\n" + instruction;
    }

    const index = skillIndex(skillIds);
    let append = result;

    const memoryContext = loadMemoryContext({ maxChars: 1200 });
    if (memoryContext) {
        append += "\n\n## Memory context\n" + memoryContext + "\n";
    }

    if (index.length > 0) {
        append += "\n\n## Enabled Skills\n";
        append += "You have the following skills available. Use them only when relevant to the task:\n\n";
        for (const entry of index) {
            append += `- ${entry.id}: ${entry.description}\n`;
        }
        append += "\nTo activate a skill, use the UseSkill tool (mcp__node-cli__UseSkill) with the skill's id.\n";
    }

    // Remove Claude Code auto-memory convention. Use node-cli's own memory system.
    append += "\n\n## Important: Do not write to home directory or any path outside the project workspace. Use the node-cli memory system for persistence.\n";
    append += "## Important: Do not edit internal state files (.node-cli/sessions/, .node-cli/project/plan.md). These are managed by the workflow controller.\n";

    return append;
}

function buildSubprocessEnvironment(model: string): NodeJS.ProcessEnv {
    return {
        ...process.env,
        ANTHROPIC_BASE_URL: OPENROUTER_BASE_URL,
        ANTHROPIC_AUTH_TOKEN: requireCredentials().value,
        ANTHROPIC_API_KEY: "",
        ANTHROPIC_DEFAULT_SONNET_MODEL: model,
        ANTHROPIC_DEFAULT_OPUS_MODEL: model,
        ANTHROPIC_DEFAULT_HAIKU_MODEL: FAST_MODEL,
    };
}