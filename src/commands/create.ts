import { input, select } from "@inquirer/prompts";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname, basename } from "node:path";
import { requireSupportedNodeVersion } from "../config/env.js";
import { getStack, listStacks, isLanguageSupported, createFirstPartyTemplate } from "../config/stacks.js";
import { detectPackageManager, runCommand, commandExists } from "./command-runner.js";
import { verifyProject, type VerificationResult } from "./verify-project.js";
import { describeError, printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";

export type CreateOptions = {
    stack?: string;
    language?: "js" | "ts";
    dir?: string;
    packageManager?: string;
    dryRun?: boolean;
    yes?: boolean;
    /** Set to false with --no-verify to skip the post-install checks. */
    verify?: boolean;
};

export async function runCreate(options: CreateOptions = {}): Promise<number> {
    await requireSupportedNodeVersion();

    let stackId = options.stack;
    if (!stackId) {
        const stacks = listStacks();
        stackId = await select({
            message: "Choose a stack:",
            choices: stacks.map((s) => ({
                name: `${s.name} (${s.languages.join("/")}) — ${s.description}`,
                value: s.id,
            })),
        });
    }

    const stack = getStack(stackId!);
    if (!stack) {
        printFailure(`Unknown stack: ${stackId}`);
        return 1;
    }

    let language: "js" | "ts" = options.language ?? "ts";
    if (!stack.languages.includes(language)) {
        printFailure(`Stack '${stack.id}' does not support language '${language}'. Supported: ${stack.languages.join(", ")}.`);
        return 1;
    }
    if (!options.language) {
        language = await select({
            message: "Language:",
            choices: stack.languages.map((l) => ({ name: l === "ts" ? "TypeScript" : "JavaScript", value: l })),
            default: stack.languages.includes("ts") ? "ts" : "js",
        }) as "js" | "ts";
    }

    const targetInput = options.dir ?? (await input({ message: "Target directory:", default: `./${stack.id}-app` }));
    const targetPath = resolve(targetInput);

    if (existsSync(targetPath)) {
        const entries = readdirSync(targetPath);
        if (entries.length > 0) {
            printFailure(`Target directory "${targetPath}" is not empty. Aborting to avoid overwriting.`);
            return 1;
        }
    } else {
        printNotice(`Creating directory: ${targetPath}`);
    }

    const packageManager = detectPackageManager(process.cwd());
    if (!commandExists(packageManager)) {
        printFailure(`Package manager '${packageManager}' not found on PATH. Set NODE_CLI_PACKAGE_MANAGER.`);
        return 1;
    }

    printNotice(`Stack: ${stack.name} (${language})`);
    printNotice(`Package manager: ${packageManager}`);
    printNotice(`Target: ${targetPath}`);
    printNotice("Planned steps:");
    const plan = stack.scaffold ? stack.scaffold(language, targetPath, packageManager) : null;
    if (plan) {
        printNotice(`  1. Scaffold via ${plan.command}`);
    } else {
        printNotice("  1. Create first-party template files");
    }
    printNotice("  2. Install dependencies");
    printNotice(`  3. Verify declared checks: ${stack.verify.join(", ")} (only scripts that exist run)`);

    if (!options.yes) {
        const { confirm } = await import("@inquirer/prompts");
        const proceed = await confirm({ message: "Proceed?", default: true });
        if (!proceed) {
            printHint("Cancelled.");
            return 0;
        }
    }

    if (options.dryRun) {
        printNotice("Dry run: no changes made.");
        return 0;
    }

    try {
        if (plan) {
            // Run from the parent directory and pass only the directory name:
            // some generators (create-vite) mishandle absolute Windows paths.
            const scaffoldCwd = dirname(targetPath);
            const scaffoldArgs = plan.args.map((a) => (a === targetPath ? basename(targetPath) : a));
            printNotice(`Running: ${plan.command} ${scaffoldArgs.join(" ")}`);
            const result = runCommand(plan.command, scaffoldArgs, { cwd: scaffoldCwd, timeoutMs: 300_000, stdio: "inherit" });
            if (result.error || result.status !== 0) {
                throw new Error(`Scaffold failed: ${result.error?.message ?? result.status}`);
            }
        } else {
            const ok = createFirstPartyTemplate(stack.id, language, targetPath);
            if (!ok) throw new Error(`No scaffold command or first-party template for ${stack.id}.`);
            printSuccess("Template files created.");
        }

        if (packageManager === "pnpm") {
            const ws = join(targetPath, "pnpm-workspace.yaml");
            if (!existsSync(ws)) {
                try { writeFileSync(ws, "onlyBuiltDependencies:\n  - esbuild\n"); } catch { /* ignore */ }
            }
        }
        const installDirs = [targetPath];
        for (const sub of ["client", "server", "frontend", "backend"]) {
            if (existsSync(join(targetPath, sub, "package.json"))) installDirs.push(join(targetPath, sub));
        }
        for (const dir of installDirs) {
            if (!existsSync(join(dir, "package.json"))) continue;
            printNotice(`Installing dependencies in ${dir}...`);
            const installArgs = packageManager === "pnpm" ? ["install", "--allow-build=esbuild"] : ["install"];
            const install = runCommand(packageManager, installArgs, { cwd: dir, timeoutMs: 300_000, stdio: "inherit" });
            if (install.error || install.status !== 0) {
                throw new Error(`Install failed in ${dir}: ${install.error?.message ?? install.status}`);
            }
        }

        printSuccess(`Project created at ${targetPath}`);

        if (options.verify === false) {
            printNotice("Verification skipped (--no-verify). The project is not verified.");
            printHint(`Next: cd ${targetPath} && ${packageManager} run dev`);
            return 0;
        }

        printNotice(`Verifying: ${stack.verify.join(", ")}`);
        const verification = verifyProject(stack, targetPath, packageManager);
        printVerification(verification, targetPath);

        if (!verification.ok) {
            printFailure(
                "The project was created, but verification failed. Treat it as unverified until the failing step is fixed.",
            );
            return 1;
        }

        printSuccess("Verification passed.");
        printHint(`Next: cd ${targetPath} && ${packageManager} run dev`);
        return 0;
    } catch (error) {
        printFailure(`Create failed: ${describeError(error)}`);
        return 1;
    }
}

function printVerification(result: VerificationResult, root: string): void {
    for (const step of result.steps) {
        const location = step.dir === root ? "." : step.dir.slice(root.length + 1);
        if (step.status === "passed") {
            printSuccess(`Verified ${step.concept} in ${location}: ${step.command}`);
        } else if (step.status === "skipped") {
            printNotice(`Skipped ${step.concept} in ${location}: ${step.reason ?? "not available"}`);
        } else {
            printFailure(
                `Failed ${step.concept} in ${location}: ${step.command} (${step.reason ?? "non-zero exit"})`,
            );
        }
    }
}

export function printStacks(): void {
    const stacks = listStacks();
    for (const s of stacks) {
        printNotice(`${s.id} — ${s.name} (${s.family})`);
        printHint(`  ${s.description}`);
        printHint(`  languages: ${s.languages.join(", ")} | verify: ${s.verify.join(", ")}`);
        printHint(`  docs: ${s.docs} (verified ${s.verifiedAt})`);
    }
}

export function printServices(): void {
    printNotice("Service integrations (modular recipes):");
    const services = [
        { id: "prisma", name: "Prisma ORM", stacks: "nextjs, express-api", note: "schema + migrations" },
        { id: "drizzle", name: "Drizzle ORM", stacks: "nextjs, express-api", note: "schema + migrations" },
        { id: "tailwind", name: "Tailwind CSS", stacks: "react-vite, nextjs", note: "utility-first styling" },
        { id: "shadcn", name: "shadcn/ui", stacks: "react-vite, nextjs", note: "component primitives" },
        { id: "vitest", name: "Vitest", stacks: "react-vite, nextjs, express-api", note: "unit testing" },
        { id: "playwright", name: "Playwright", stacks: "all", note: "browser E2E" },
        { id: "eslint", name: "ESLint", stacks: "all", note: "linting" },
    ];
    for (const s of services) {
        printNotice(`${s.id} — ${s.name}`);
        printHint(`  stacks: ${s.stacks} | ${s.note}`);
    }
    printHint("Services are optional and must be explicitly selected; none are auto-provisioned.");
}
