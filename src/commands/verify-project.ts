import { existsSync, readFileSync, readdirSync } from "node:fs";
import { relative } from "node:path";
import { join } from "node:path";
import {
    runCommand,
    type CommandResult,
    type PackageManager,
} from "./command-runner.js";
import type { StackDefinition } from "../config/stacks.js";

export type VerifyConcept = "typecheck" | "build" | "test";

export type VerificationStep = {
    concept: VerifyConcept;
    /** Directory the command ran in. */
    dir: string;
    /** Human-readable command, e.g. `pnpm run build`. */
    command: string;
    status: "passed" | "failed" | "skipped";
    exitCode: number | null;
    /** Present for skipped steps and non-zero exits. */
    reason?: string;
};

export type VerificationResult = {
    /** False only when a command that ran exited non-zero. */
    ok: boolean;
    steps: VerificationStep[];
};

export type VerifyExecutor = (
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; stdio: "inherit" },
) => CommandResult;

export type VerifyOptions = {
    executor?: VerifyExecutor;
    timeoutMs?: number;
    /** Subpackage directories to inspect in addition to the project root. */
    subdirectories?: string[];
};

const DEFAULT_SUBDIRECTORIES = ["client", "server", "frontend", "backend"];
const SKIP_DIRECTORIES = new Set(["node_modules", ".git", "dist", "build", "coverage", ".next"]);

type PackageTarget = {
    dir: string;
    scripts: Record<string, string>;
};

/**
 * Runs the stack's declared verification concepts against the scripts that
 * actually exist. A concept without a script is reported as skipped rather
 * than as a pass, so "Verify: typecheck, build" in the plan can never make a
 * project look verified when nothing ran.
 */
export function verifyProject(
    stack: StackDefinition,
    targetPath: string,
    packageManager: PackageManager,
    options: VerifyOptions = {},
): VerificationResult {
    const executor = options.executor ?? runCommand;
    const timeoutMs = options.timeoutMs ?? 300_000;
    const targets = collectTargets(targetPath, options.subdirectories ?? DEFAULT_SUBDIRECTORIES);
    const steps: VerificationStep[] = [];
    const seen = new Set<string>();

    for (const concept of stack.verify) {
        if (seen.has(concept)) continue;
        seen.add(concept);

        if (!isVerifyConcept(concept)) {
            steps.push({
                concept: "build",
                dir: targetPath,
                command: "",
                status: "skipped",
                exitCode: null,
                reason: `Unknown verification concept "${concept}" in the stack definition.`,
            });
            continue;
        }

        for (const target of selectTargetsFor(concept, targets)) {
            const script = target.scripts[concept];
            if (!script) {
                steps.push({
                    concept,
                    dir: target.dir,
                    command: "",
                    status: "skipped",
                    exitCode: null,
                    reason: `No "${concept}" script in ${displayDir(target.dir, targetPath)}/package.json.`,
                });
                continue;
            }

            if (concept === "test" && !hasTestFiles(target.dir)) {
                steps.push({
                    concept,
                    dir: target.dir,
                    command: `${packageManager} run test`,
                    status: "skipped",
                    exitCode: null,
                    reason: "The test script exists but no test files were found, so it was not run.",
                });
                continue;
            }

            const args = ["run", concept];
            const result = executor(packageManager, args, {
                cwd: target.dir,
                timeoutMs,
                stdio: "inherit",
            });

            const failed = Boolean(result.error) || result.status !== 0;
            steps.push({
                concept,
                dir: target.dir,
                command: `${packageManager} run ${concept}`,
                status: failed ? "failed" : "passed",
                exitCode: result.status,
                ...(failed
                    ? {
                          reason: result.error?.message ?? `Exited with status ${result.status}.`,
                      }
                    : {}),
            });
        }
    }

    return {
        ok: steps.every((step) => step.status !== "failed"),
        steps,
    };
}

/**
 * Picks the packages that own a concept. A root `build` script usually
 * orchestrates workspaces, so running it once at the root is both sufficient
 * and faster than rebuilding each package separately.
 */
function selectTargetsFor(concept: VerifyConcept, targets: PackageTarget[]): PackageTarget[] {
    const owners = targets.filter((target) => typeof target.scripts[concept] === "string");
    if (owners.length === 0) {
        return [targets[0]];
    }
    if (concept === "build") {
        const root = targets[0];
        if (root.scripts.build) return [root];
    }
    return owners;
}

function collectTargets(rootDir: string, subdirectories: string[]): PackageTarget[] {
    const targets: PackageTarget[] = [readTarget(rootDir)].filter(
        (target): target is PackageTarget => target !== null,
    );

    for (const sub of subdirectories) {
        const dir = join(rootDir, sub);
        const target = readTarget(dir);
        if (target) targets.push(target);
    }

    // Always have a root entry so skipped messages have a stable location.
    if (targets.length === 0) targets.push({ dir: rootDir, scripts: {} });
    return targets;
}

function readTarget(dir: string): PackageTarget | null {
    const packageJson = join(dir, "package.json");
    if (!existsSync(packageJson)) return null;
    try {
        const parsed = JSON.parse(readFileSync(packageJson, "utf8")) as {
            scripts?: Record<string, unknown>;
        };
        const scripts: Record<string, string> = {};
        for (const [name, value] of Object.entries(parsed.scripts ?? {})) {
            if (typeof value === "string" && value.trim()) scripts[name] = value;
        }
        return { dir, scripts };
    } catch {
        return { dir, scripts: {} };
    }
}

/** Detects real test files without treating a bare `test` script as one. */
export function hasTestFiles(dir: string): boolean {
    if (!existsSync(dir)) return false;

    const walk = (current: string, depth: number): boolean => {
        if (depth > 6) return false;
        let entries;
        try {
            entries = readdirSync(current, { withFileTypes: true });
        } catch {
            return false;
        }
        for (const entry of entries) {
            if (entry.isDirectory()) {
                if (SKIP_DIRECTORIES.has(entry.name)) continue;
                if (walk(join(current, entry.name), depth + 1)) return true;
                continue;
            }
            if (/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name)) return true;
        }
        return false;
    };

    return walk(dir, 0);
}

function isVerifyConcept(value: string): value is VerifyConcept {
    return value === "typecheck" || value === "build" || value === "test";
}

function displayDir(dir: string, root: string): string {
    const rel = relative(root, dir);
    return rel ? rel.replace(/\\/g, "/") : ".";
}
