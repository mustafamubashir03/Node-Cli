import type { CanUseTool, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { resolve, relative, isAbsolute } from "node:path";
import { getActiveMode } from "./active-mode.js";
import { MODES, isToolAllowed, toolSurface, type Mode } from "./modes.js";
import { classifyShellRisk, type ShellRisk } from "./command-risk.js";
import { confirmInTerminal } from "../ui/confirm.js";
import { readAppConfig } from "../config/app-config.js";
import { evaluateWithApprovalGate } from "../workflow/approval-gate.js";

const CONFIRMATION_REQUIRED_TOOLS = ["Edit", "Write", "Bash", "NotebookEdit"];

/**
 * Decision produced by the policy layer.
 *
 * - "allow": the operation may proceed without asking the user.
 * - "deny": the operation must not proceed; carries a reason.
 * - "confirm": the operation is allowed only after the user approves it.
 */
export type ToolDecision = {
    behavior: "allow" | "deny" | "confirm";
    message?: string;
    /** Whether the denial is retryable (false for policy denials). */
    retryable?: boolean;
    /** Machine-readable reason code for denials. */
    reasonCode?: string;
};

/**
 * Normalizes Git Bash-style paths (e.g. /c:/Users/...) to native Windows
 * paths (C:\\Users\\...) so SDK-native file tools work on Windows.
 * Returns the normalized input if any path was changed, otherwise null.
 */
export function normalizeToolPaths(
    toolName: string,
    input: Record<string, unknown>,
): Record<string, unknown> | null {
    if (process.platform !== "win32") return null;
    const pathKeys = ["file_path", "path", "notebook_path"];
    let changed = false;
    const result = { ...input };
    for (const key of pathKeys) {
        const value = result[key];
        if (typeof value !== "string") continue;
        const normalized = normalizeWindowsPath(value);
        if (normalized !== value) {
            result[key] = normalized;
            changed = true;
        }
    }
    return changed ? result : null;
}

export function normalizeWindowsPath(p: string): string {
    // Git Bash style: /c:/path or /c/path
    const match = p.match(/^\/([a-zA-Z]):[\/\\](.*)$/);
    if (match) {
        return `${match[1].toUpperCase()}:\\${match[2].replace(/\//g, "\\")}`;
    }
    // /c/path (without colon)
    const match2 = p.match(/^\/([a-zA-Z])\/(.*)$/);
    if (match2) {
        return `${match2[1].toUpperCase()}:\\${match2[2].replace(/\//g, "\\")}`;
    }
    return p;
}

/** Tracks non-retryable denials so identical calls are not re-executed. */
const nonRetryableDenials = new Set<string>();

function denialKey(toolName: string, input: Record<string, unknown>): string {
    const path = input.file_path ?? input.path ?? input.command ?? "";
    return `${toolName}:${String(path)}`;
}

export function createCanUseTool(projectRoot: string = process.cwd()): CanUseTool {
    return async (toolName, input) => {
        const mode = getActiveMode();

        // If this exact call was previously denied with retryable:false, block immediately.
        const key = denialKey(toolName, input);
        if (nonRetryableDenials.has(key)) {
            return {
                behavior: "deny",
                message: `Blocked: identical call previously denied with retryable:false. Reason: NON_RETRYABLE_DENIED. Remediation: Change the approach or ask the user.`,
                retryable: false,
                reasonCode: "NON_RETRYABLE_DENIED",
            };
        }

        // Secret file protection: block access to credential files.
        const rawTarget = ["file_path", "path", "notebook_path", "command"]
            .map((key) => input[key])
            .find((value) => typeof value === "string" && value.length > 0) as string | undefined;
        if (rawTarget) {
            const normalized = rawTarget.replace(/\\/g, "/").toLowerCase();
            const secretPatterns = [".env", ".env.", "credentials", "secrets", "token", "api_key", "apikey", ".claude"];
            const isSecretAccess = secretPatterns.some((p) => normalized.includes(p));
            if (isSecretAccess && (toolName === "Read" || toolName === "Edit" || toolName === "Write" || toolName === "Bash" || toolName === "Grep" || toolName === "Glob")) {
                // Allow .env.example (not actual secrets)
                if (!normalized.includes(".env.example") && !normalized.includes(".env.sample")) {
                    nonRetryableDenials.add(key);
                    return {
                        behavior: "deny" as const,
                        message: `Access to secret/credential files is blocked for security. Reason: SECRET_FILE_PROTECTED. Remediation: Remove the file from the command or use a non-secret file.`,
                        retryable: false,
                        reasonCode: "SECRET_FILE_PROTECTED",
                    };
                }
            }
        }

        // Approval gate: block project writes until the plan is approved
        // in plan-first workflows. Read-only tools are never blocked.
        const gateDecision = evaluateWithApprovalGate(toolName, input);
        if (gateDecision) {
            if (gateDecision.behavior === "deny") {
                nonRetryableDenials.add(key);
                return {
                    behavior: "deny" as const,
                    message: gateDecision.message ?? `Tool '${toolName}' blocked by approval gate.`,
                    retryable: false,
                    reasonCode: (gateDecision as any).reasonCode,
                };
            }
            // allow: continue to normal permission evaluation
        }

        if (!isToolAllowed(mode, toolName)) {
            return {
                behavior: "deny",
                message:
                    `Tool '${toolName}' is not allowed in '${mode}' mode. ` +
                    `Allowed tools: ${toolSurface(mode)}.`,
            };
        }

        const decision = evaluateToolCall({
            toolName,
            input,
            projectRoot,
            strict: MODES[mode].strict === true,
        });

        if (decision.behavior === "confirm") {
            const approved = await confirmInTerminal(decision.message ?? `Allow '${toolName}'? [y/N]`);
            if (!approved) {
                return {
                    behavior: "deny",
                    message: `The user declined '${toolName}'. Ask before trying again.`,
                };
            }
            const normalized = normalizeToolPaths(toolName, input);
            if (normalized) {
                return { behavior: "allow", updatedInput: normalized };
            }
            return { behavior: "allow" };
        }

        if (decision.behavior === "deny") {
            if (decision.retryable === false) {
                nonRetryableDenials.add(key);
            }
            return {
                behavior: "deny",
                message: decision.message ?? `Tool '${toolName}' was not allowed.`,
                retryable: decision.retryable,
                reasonCode: decision.reasonCode,
            };
        }

        const normalized = normalizeToolPaths(toolName, input);
        if (normalized) {
            return { behavior: "allow", updatedInput: normalized };
        }
        return { behavior: "allow" };
    };
}

/**
 * Applies the permission policy for a single tool call.
 *
 * Standard mode (the default for `agent`):
 * - routine in-project file writes are allowed without prompting;
 * - safe shell commands (reads, git inspection, installs, dev servers, checks)
 *   are allowed without prompting;
 * - risky or destructive shell commands require approval or are denied.
 *
 * Strict mode keeps manual approval for operations the standard policy would
 * auto-allow, while preserving the same security boundaries.
 */
export function evaluateToolCall(params: {
    toolName: string;
    input: Record<string, unknown>;
    projectRoot: string;
    strict: boolean;
}): ToolDecision {
    const { toolName, input, projectRoot, strict } = params;

    if (toolName === "Bash") {
        const command = typeof input.command === "string" ? input.command : "";
        const risk: ShellRisk = classifyShellRisk(command);

        if (risk === "dangerous") {
            return {
                behavior: "deny",
                message: `Blocked destructive shell command: ${command.trim()}`,
            };
        }

        const question = `Allow '${toolName}' (${command.trim()})? [y/N]`;
        if (risk === "safe" && !strict) {
            return { behavior: "allow" };
        }
        if (risk === "safe" && strict) {
            return { behavior: "confirm", message: `Strict mode: ${question}` };
        }
        return { behavior: "confirm", message: question };
    }

    if (CONFIRMATION_REQUIRED_TOOLS.includes(toolName) && toolName !== "Bash") {
        const rawTarget = ["file_path", "path", "notebook_path"]
            .map((key) => input[key])
            .find((value) => typeof value === "string" && value.length > 0) as string | undefined;

        const target = rawTarget ? normalizeWindowsPath(rawTarget) : undefined;

        if (!target) {
            return { behavior: "confirm", message: `Allow '${toolName}'? [y/N]` };
        }

        if (!isPathInsideRoot(target, projectRoot)) {
            // Check the configurable write allow-list before denying
            if (isPathInAllowList(target, projectRoot)) {
                return { behavior: "allow" };
            }
            return {
                behavior: "deny",
                message: `Path outside the authorized project root is blocked. Reason: PATH_OUTSIDE_WORKSPACE. Remediation: Use a path inside the project root, or add the directory to writeAllowList in config. Target: ${target}`,
                retryable: false,
                reasonCode: "PATH_OUTSIDE_WORKSPACE",
            };
        }

        if (strict) {
            return { behavior: "confirm", message: `Strict mode: Allow '${toolName}' (${target})? [y/N]` };
        }
        return { behavior: "allow" };
    }

    return { behavior: "allow" };
}

/**
 * Resolves whether a target path stays inside the authorized project root.
 * Relative paths resolve against the root; traversal outside it is rejected.
 */
export function isPathInsideRoot(target: string, projectRoot: string): boolean {
    const resolvedRoot = resolve(projectRoot);
    const resolvedTarget = isAbsolute(target) ? resolve(target) : resolve(resolvedRoot, target);
    const relativePath = relative(resolvedRoot, resolvedTarget);
    if (relativePath === "") {
        // The root itself is treated as inside the workspace.
        return true;
    }
    if (isAbsolute(relativePath)) {
        return false;
    }
    return !relativePath.startsWith("..");
}

/** Checks whether a target path is within the configurable write allow-list. */
export function isPathInAllowList(target: string, projectRoot: string): boolean {
    const config = readAppConfig();
    const allowList = config.writeAllowList ?? [];
    // Always include the CLI cache dir as an allowed write target
    const cacheDir = process.env.NODE_CLI_CACHE_DIR ?? "";
    const roots = [projectRoot, ...allowList, cacheDir].filter(Boolean);

    const resolvedTarget = isAbsolute(target) ? resolve(target) : resolve(projectRoot, target);

    for (const root of roots) {
        try {
            const resolvedRoot = resolve(root);
            const rel = relative(resolvedRoot, resolvedTarget);
            if (rel === "" || (!isAbsolute(rel) && !rel.startsWith(".."))) {
                return true;
            }
        } catch {
            // Skip malformed roots
        }
    }
    return false;
}

export function createModeGuardHook(): HookCallback {
    return async (input) => {
        if (input.hook_event_name !== "PreToolUse") {
            return {};
        }

        const mode = getActiveMode();
        const toolName = input.tool_name;
        if (isToolAllowed(mode, toolName)) {
            return {};
        }

        const hint =
            mode === "agent"
                ? ""
                : " Switch to agent mode with /mode agent to make changes.";

        return {
            hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason:
                    `'${toolName}' is not available in '${mode}' mode. ` +
                    `Only these tools are allowed in '${mode}' mode: ${toolSurface(mode)}.${hint}`,
            },
        };
    };
}

function describeApproval(toolName: string, input: Record<string, unknown>): string {
    const subject = ["file_path", "command", "pattern", "url"]
        .map((key) => input[key])
        .find((value) => typeof value === "string" && value);

    return `Allow '${toolName}${subject ? ` (${subject})` : ""}'? [y/N]`;
}
