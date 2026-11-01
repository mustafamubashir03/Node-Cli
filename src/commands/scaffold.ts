import { confirm, input, select } from "@inquirer/prompts";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { requireSupportedNodeVersion } from "../config/env.js";
import {
    commandExists,
    commandFailureMessage,
    detectPackageManager,
    formatCommand,
    runCommand,
    type CommandResult,
    type PackageManager,
} from "./command-runner.js";
import { describeError, printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";

const SUPPORTED_FRAMEWORKS = [
    { name: "React + Vite", value: "react-vite" },
    { name: "Next.js", value: "nextjs" },
    { name: "Vue", value: "vue" },
    { name: "SvelteKit", value: "sveltekit" },
    { name: "Astro", value: "astro" },
    { name: "Vanilla JS/TS", value: "vanilla" },
];

export async function runScaffold(): Promise<void> {
    await requireSupportedNodeVersion();

    const framework = await select({
        message: "Choose a framework to scaffold:",
        choices: SUPPORTED_FRAMEWORKS.map((f) => ({ name: f.name, value: f.value })),
    });

    const targetInput = await input({
        message: "Target directory:",
        default: "./my-project",
    });

    const targetPath = resolve(targetInput);

    if (existsSync(targetPath)) {
        const entries = readdirSync(targetPath);
        if (entries.length > 0) {
            printFailure(
                `Target directory "${targetPath}" is not empty. Please choose an empty directory or a new path.`,
            );
            return;
        }
    } else {
        printNotice(`Creating directory: ${targetPath}`);
    }

    console.log();
    printNotice(`Scaffolding ${framework} project in ${targetPath}`);
    printNotice("This will create the project and install dependencies.");
    console.log();

    const proceed = await confirm({
        message: "Proceed with scaffold?",
        default: true,
    });

    if (!proceed) {
        printHint("Scaffold cancelled.");
        return;
    }

    try {
        await scaffoldProject(framework, targetPath);
    } catch (error) {
        printFailure(`Scaffold failed: ${describeError(error)}`);
    }
}

async function scaffoldProject(framework: string, targetPath: string): Promise<void> {
    const packageManager = detectPackageManager(process.cwd());

    if (!commandExists(packageManager)) {
        throw new Error(
            `The detected package manager '${packageManager}' is not on PATH. ` +
                "Install it, or set NODE_CLI_PACKAGE_MANAGER to pnpm, npm, or yarn.",
        );
    }

    printNotice(`Using package manager: ${packageManager}`);

    const initializer = initializerFor(packageManager, framework, targetPath);

    // Validate the target before running anything. On Windows this prevents a
    // path containing cmd.exe metacharacters from being interpreted by the
    // shell; the arguments are still passed through the runner's denylist.
    runOrThrow(initializer.command, initializer.args, {
        cwd: process.cwd(),
        timeoutMs: 300_000,
    });

    await installDeps(targetPath, packageManager);

    printSuccess(`Project created at ${targetPath}`);
    printNotice("Run 'node-cli wake-up' to start coding with the AI assistant.");
}

type Initializer = { command: string; args: string[] };

/**
 * Selects the initializer that matches the project's package manager. Earlier
 * versions always ran npm/npx, which failed when only pnpm was installed and
 * could not start `.cmd` shims on Windows.
 */
export function initializerFor(
    packageManager: PackageManager,
    framework: string,
    targetPath: string,
): Initializer {
    const runPackage = (spec: string, args: string[]): Initializer => {
        if (packageManager === "npm") {
            return {
                command: "npx",
                args: ["--yes", spec, ...args],
            };
        }
        return {
            command: packageManager,
            args: ["dlx", spec, ...args],
        };
    };

    switch (framework) {
        case "react-vite":
            return runPackage("create-vite@latest", [targetPath, "--template", "react-ts"]);
        case "nextjs":
            return runPackage("create-next-app@latest", [
                targetPath,
                "--typescript",
                "--tailwind",
                "--eslint",
                "--app",
                "--src-dir",
                "--import-alias",
                "@/*",
                "--no-git",
            ]);
        case "vue":
            return runPackage("create-vue@latest", [
                targetPath,
                "--typescript",
                "--router",
                "--pinia",
                "--vitest",
            ]);
        case "sveltekit":
            // `sv` is the current official Svelte CLI; `svite`/`create-svelte`
            // are not SvelteKit's scaffolder.
            return runPackage("sv@latest", [
                "create",
                "--template",
                "minimal",
                "--types",
                "ts",
                "--no-add-ons",
                "--no-install",
                targetPath,
            ]);
        case "astro":
            return runPackage("create-astro@latest", [
                targetPath,
                "--template",
                "minimal",
                "--no-install",
                "--no-git",
                "--skip-houston",
            ]);
        case "vanilla":
            return runPackage("create-vite@latest", [targetPath, "--template", "vanilla"]);
        default:
            throw new Error(`Unsupported framework: ${framework}`);
    }
}

function runOrThrow(
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number },
): CommandResult {
    printNotice(`Running: ${formatCommand(command, args)}`);
    const result = runCommand(command, args, {
        cwd: options.cwd,
        timeoutMs: options.timeoutMs,
        stdio: "inherit",
    });

    if (result.error || result.status !== 0) {
        throw new Error(commandFailureMessage(result));
    }
    return result;
}

async function installDeps(targetPath: string, packageManager: PackageManager): Promise<void> {
    printNotice("Installing dependencies (this may take a moment)...");
    runOrThrow(packageManager, ["install"], {
        cwd: targetPath,
        timeoutMs: 300_000,
    });
}
