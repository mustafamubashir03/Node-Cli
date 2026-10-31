import { Command, InvalidArgumentError } from "commander";
import { ALL_MODES, parseMode, type Mode } from "../agent/modes.js";
import { runDoctor } from "../commands/doctor.js";
import { startChat } from "../commands/chat.js";
import { runOneShotPrompt } from "../commands/one-shot-prompt.js";
import { runSetup } from "../commands/setup.js";
import { runScaffold } from "../commands/scaffold.js";
import { runCreate, printStacks, printServices } from "../commands/create.js";
import { runAdd, printServicesList } from "../commands/add.js";
import { runQaCommand } from "../commands/qa.js";
import { runEvalCommand } from "../commands/eval.js";
import { wakeUp } from "../commands/wake-up.js";
import { printBanner } from "../ui/banner.js";
import { runFigmaSetup, runFigmaStatus, runFigmaTest, runFigmaDisconnect } from "../commands/figma.js";
import { runFigmaToCode } from "../commands/figma-to-code.js";
import { runVisualQACommand } from "../commands/visual-qa.js";

const MODE_FLAG = "-m, --mode <mode>";
const MODE_DESCRIPTION = `Mode to use: ${ALL_MODES.join(" | ")}`;
const VERBOSE_FLAG = "-v, --verbose";
const VERBOSE_DESCRIPTION = "Show every message the model sends back";

type ChatOptions = { mode?: Mode; verbose?: boolean };

export function createCli(): Command {
    const program = new Command()
        .name("node-cli")
        .description("An AI coding assistant that runs in your terminal")
        .version("1.0.0");

    program
        .command("chat")
        .description("Start an interactive chat session")
        .option(MODE_FLAG, MODE_DESCRIPTION, parseModeFlag, "agent")
        .option(VERBOSE_FLAG, VERBOSE_DESCRIPTION, false)
        .action(async (options: ChatOptions) => {
            await startChat(options);
        });

    program
        .command("run")
        .description("Send one prompt, print the answer, exit")
        .argument("<prompt>", "What to ask the agent")
        .option(MODE_FLAG, MODE_DESCRIPTION, parseModeFlag, "agent")
        .option(VERBOSE_FLAG, VERBOSE_DESCRIPTION, false)
        .option("--timeout <ms>", "Total run time in milliseconds (not per message)", (v) => Number(v))
        .option("--report <path>", "Write JSON and Markdown diagnostics to this path (use 'off' to disable)")
        .action(async (prompt: string, options: ChatOptions & { timeout?: number; report?: string }) => {
            await runOneShotPrompt(prompt, {
                mode: options.mode,
                verbose: options.verbose,
                timeoutMs: options.timeout,
                reportPath: options.report,
            });
        });

    program
        .command("talk")
        .description("Same as run, always in agent mode")
        .argument("<prompt>", "What to ask the agent")
        .option(VERBOSE_FLAG, VERBOSE_DESCRIPTION, false)
        .option("--timeout <ms>", "Total run time in milliseconds (not per message)", (v) => Number(v))
        .option("--report <path>", "Write JSON and Markdown diagnostics to this path (use 'off' to disable)")
        .action(async (prompt: string, options: { verbose?: boolean; timeout?: number; report?: string }) => {
            await runOneShotPrompt(prompt, {
                mode: "agent",
                verbose: options.verbose,
                timeoutMs: options.timeout,
                reportPath: options.report,
            });
        });

    program
        .command("eval")
        .description("Run the deterministic skill-selection golden dataset")
        .argument("[dataset]", "Path to a golden dataset JSON file")
        .option("--json <path>", "Write the evaluation JSON here")
        .option("--markdown <path>", "Write the evaluation report here")
        .option("-v, --verbose", "Print every case result")
        .option("--fail-on-miss", "Exit non-zero when any case fails")
        .action(async (dataset: string | undefined, options: { json?: string; markdown?: string; verbose?: boolean; failOnMiss?: boolean }) => {
            const exitCode = await runEvalCommand({
                datasetPath: dataset,
                jsonPath: options.json,
                markdownPath: options.markdown,
                verbose: options.verbose,
                failOnMiss: options.failOnMiss,
            });
            if (exitCode !== 0) process.exitCode = exitCode;
        });

    program
        .command("doctor")
        .description("Check the Node version and the credentials")
        .action(async () => {
            await runDoctor();
        });

    program
        .command("banner")
        .description("Print the banner")
        .action(() => {
            printBanner();
        });

    program
        .command("setup")
        .description("Add an API key to .env when none was found")
        .action(async () => {
            await runSetup();
        });

    program
        .command("wake-up")
        .description("Show the banner, check the setup, pick a mode, then chat")
        .option("-e, --export-design-tokens", "Export design tokens to stdout")
        .option("--visual-qa", "Check whether the browser QA tooling is installed")
        .action(async (options) => {
            await wakeUp({
                exportDesignTokens: options.exportDesignTokens,
                visualQA: options.visualQA,
            });
        });

    program
        .command("scaffold")
        .description("Scaffold a new project with a framework template")
        .action(async () => {
            await runScaffold();
        });

    program
        .command("create")
        .description("Create a new project from a supported stack")
        .argument("[stack]", "Stack id (e.g. react-vite, nextjs, express-api, mern)")
        .option("-l, --language <language>", "Language: js or ts", (v) => (v === "js" || v === "ts" ? v : undefined))
        .option("-d, --dir <dir>", "Target directory")
        .option("--dry-run", "Print the plan without executing")
        .option("-y, --yes", "Skip confirmation")
        .option("--no-verify", "Skip the post-install verification commands")
        .action(async (stack: string | undefined, options) => {
            const exitCode = await runCreate({ stack, language: options.language, dir: options.dir, dryRun: options.dryRun, yes: options.yes, verify: options.verify });
            if (exitCode !== 0) process.exitCode = exitCode;
        });

    program
        .command("stacks")
        .description("List supported stacks")
        .action(() => {
            printStacks();
        });

    program
        .command("templates")
        .description("List available project templates")
        .action(() => {
            printStacks();
        });

    program
        .command("services")
        .description("List available service integrations")
        .action(() => {
            printServicesList();
        });

    program
        .command("add")
        .description("Add a service integration to an existing project")
        .argument("[service]", "Service id (prisma, drizzle, tailwind, vitest, playwright, eslint, shadcn)")
        .option("-d, --dir <dir>", "Project directory")
        .option("--database <db>", "Database provider: postgresql or sqlite")
        .option("--dry-run", "Print the plan without executing")
        .option("-y, --yes", "Skip confirmation")
        .action(async (service: string | undefined, options) => {
            const exitCode = await runAdd({ service, dir: options.dir, database: options.database, dryRun: options.dryRun, yes: options.yes });
            if (exitCode !== 0) process.exitCode = exitCode;
        });

    program
        .command("qa")
        .description("Load a URL in a headless browser and report load, console, and overflow problems")
        .argument("<url>", "Page to check (http/https, or localhost:port)")
        .action(async (url: string) => {
            const exitCode = await runQaCommand(url);
            if (exitCode !== 0) process.exitCode = exitCode;
        });

    const figmaCmd = program
        .command("figma")
        .description("Figma integration commands");

    figmaCmd
        .command("setup")
        .description("Configure Figma access token")
        .action(async () => {
            await runFigmaSetup();
        });

    figmaCmd
        .command("status")
        .description("Check Figma connection status")
        .action(async () => {
            await runFigmaStatus();
        });

    figmaCmd
        .command("test")
        .description("Test Figma connection with a URL")
        .argument("<url>", "Figma file or frame URL")
        .action(async (url: string) => {
            await runFigmaTest(url);
        });

    figmaCmd
        .command("disconnect")
        .description("Remove Figma configuration")
        .action(async () => {
            await runFigmaDisconnect();
        });

    program
        .command("figma-to-code")
        .description("Convert a Figma design to code (interactive)")
        .action(async () => {
            await runFigmaToCode();
        });

    program
        .command("visual-qa")
        .description("Run visual QA on a URL with optional reference comparison")
        .argument("<url>", "Page URL to check")
        .option("--reference <path>", "Reference screenshot path for comparison")
        .option("--screenshot <path>", "Screenshot output path")
        .option("--width <n>", "Viewport width", (v) => Number(v), 1280)
        .option("--height <n>", "Viewport height", (v) => Number(v), 720)
        .action(async (url: string, options: { reference?: string; screenshot?: string; width: number; height: number }) => {
            await runVisualQACommand({
                url,
                referencePath: options.reference,
                screenshotPath: options.screenshot,
                viewport: { width: options.width, height: options.height },
            });
        });

    program
        .command("help")
        .description("Print the banner and the command list")
        .action(() => {
            printBanner();
            program.help();
        });

    return program;
}

function parseModeFlag(value: string): Mode {
    const mode = parseMode(value);
    if (!mode) {
        throw new InvalidArgumentError(
            `Expected ${ALL_MODES.join(", ")} but received "${value}".`,
        );
    }
    return mode;
}