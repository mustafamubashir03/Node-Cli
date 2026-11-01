import { ALL_MODES, MODES, parseMode, toolSurface, type Mode } from "../agent/modes.js";
import { refreshSessionSkills, switchMode, type AgentSession, type ModeSwitch } from "../agent/session.js";
import { readAppConfig } from "../config/app-config.js";
import { availableEnabledSkills } from "../skills/registry.js";
import { runModelSwitch, setModelDirect } from "../commands/model.js";
import { runSkillsAdd, runSkillsCommand, runSkillsFetch, skillStatusLine } from "../commands/skills.js";
import { runPlanCommand, updateTaskStatus } from "../commands/plan.js";
import { runMemoryCommand } from "../commands/memory.js";
import { runQaCommand } from "../commands/qa.js";
import { runFigmaToCode } from "../commands/figma-to-code.js";
import {
    describeError,
    printCommandList,
    printContextReport,
    printFailure,
    printHint,
    printSuccess,
    printNotice,
    printSessionHeader,
    printWarning,
    type LabeledRow,
} from "../ui/messages.js";

export type SlashCommandOutcome = "handled" | "quit";

type SlashCommandContext = {
    argument: string;
    session: AgentSession;
    verbose: boolean;
};

type SlashCommand = {
    name: string;
    argument?: string;
    description: string;
    run: (context: SlashCommandContext) => Promise<SlashCommandOutcome>;
};

const commands: SlashCommand[] = [
    {
        name: "/help",
        description: "list the available slash commands",
        run: async () => {
            printSlashCommandHelp();
            return "handled";
        },
    },
    {
        name: "/mode",
        argument: `<${ALL_MODES.join("|")}>`,
        description: "switch the mode",
        run: async ({ argument, session, verbose }) => {
            await runModeSwitch(argument, session, verbose);
            return "handled";
        },
    },
    {
        name: "/model",
        argument: "<model>",
        description: "switch the OpenRouter model (run with no argument to pick one)",
        run: async ({ argument, session }) => {
            await switchModelCommand(argument, session);
            printSessionHeader(session.mode, toolSurface(session.mode));
            return "handled";
        },
    },
    {
        name: "/models",
        argument: "<model>",
        description: "alias for /model",
        run: async ({ argument, session }) => {
            await switchModelCommand(argument, session);
            printSessionHeader(session.mode, toolSurface(session.mode));
            return "handled";
        },
    },
    {
        name: "/skills",
        argument: "<url> | <name>",
        description: "enable/disable skills, add from GitHub URL, or fetch catalog skill",
        run: async ({ argument, session }) => {
            if (argument) {
                if (argument.startsWith("http")) {
                    await runSkillsAdd(argument);
                } else {
                    await runSkillsFetch(argument);
                }
            } else {
                await runSkillsCommand(session);
            }
            await refreshSkills(session);
            printSessionHeader(session.mode, toolSurface(session.mode));
            printNotice(skillStatusLine());
            return "handled";
        },
    },
    {
        name: "/context",
        description: "show how full the context window is",
        run: async ({ session }) => {
            await printContextUsage(session);
            return "handled";
        },
    },
    {
        name: "/clear",
        description: "clear the terminal",
        run: async () => {
            console.clear();
            printWarning("Console cleared.");
            return "handled";
        },
    },
    {
        name: "/plan",
        argument: "[goal]",
        description: "create plan.md and tasks.md for deliberate planning",
        run: async ({ argument }) => {
            if (argument.startsWith("done ")) {
                const task = argument.slice(5).trim();
                const ok = updateTaskStatus(process.cwd(), task, true);
                if (ok) printSuccess(`Marked complete: ${task}`);
                else printFailure(`Task not found: ${task}`);
                return "handled";
            }
            if (argument.startsWith("reopen ")) {
                const task = argument.slice(7).trim();
                const ok = updateTaskStatus(process.cwd(), task, false);
                if (ok) printSuccess(`Reopened: ${task}`);
                else printFailure(`Task not found: ${task}`);
                return "handled";
            }
            const force = argument.includes("--force");
            const goal = argument.replace("--force", "").trim();
            await runPlanCommand(goal, { force });
            return "handled";
        },
    },
    {
        name: "/memory",
        argument: "[sources|list|search|save|delete|context]",
        description: "inspect and manage persistent memory",
        run: async ({ argument }) => {
            await runMemoryCommand(argument);
            return "handled";
        },
    },
    {
        name: "/qa",
        argument: "<url>",
        description: "load a URL in a headless browser and report console errors and overflow",
        run: async ({ argument }) => {
            await runQaCommand(argument);
            return "handled";
        },
    },
    {
        name: "/figma-to-code",
        description: "Convert a Figma design to code (interactive)",
        run: async () => {
            await runFigmaToCode();
            return "handled";
        },
    },
    {
        name: "/exit",
        description: "close the chat and quit",
        run: async () => "quit",
    },
];

export function printSlashCommandHelp(): void {
    printCommandList(
        "Available slash commands",
        commands.map((command): LabeledRow => ({
            label: command.argument ? `${command.name} ${command.argument}` : command.name,
            value: command.description,
        })),
    );
}

export async function runSlashCommand(
    line: string,
    session: AgentSession,
    options: { verbose?: boolean } = {},
): Promise<SlashCommandOutcome | null> {
    if (!line.startsWith("/")) {
        return null;
    }

    const [name = "", ...rest] = line.split(/\s+/);
    const command = commands.find((candidate) => candidate.name === name.toLowerCase());

    if (!command) {
        printWarning(`Unknown command '${name}'. Type /help for the list.`);
        return "handled";
    }

    return command.run({
        argument: rest.join(" "),
        session,
        verbose: options.verbose === true,
    });
}

/**
 * Keeps the live session's system prompt and UseSkill server in sync with the
 * saved skill list. The chat router uses `session.sessionSkills`, so routing
 * and activation can never disagree about what is enabled.
 */
async function refreshSkills(session: AgentSession): Promise<void> {
    const enabled = availableEnabledSkills(readAppConfig().skills ?? []);
    try {
        const restarted = await refreshSessionSkills(session, enabled);
        if (restarted) {
            printNotice("Skills refreshed for this session.");
        }
    } catch (error) {
        printFailure(
            `Skills were saved but the session could not be refreshed: ${describeError(error)}. Restart the chat to apply them.`,
        );
    }
}

async function runModeSwitch(
    argument: string,
    session: AgentSession,
    verbose: boolean,
): Promise<void> {    const requestedMode = parseMode(argument);
    if (!requestedMode) {
        printWarning(`Usage: /mode <${ALL_MODES.join("|")}>.`);
        return;
    }

    const change = await attemptModeSwitch(session, requestedMode);
    if (!change) {
        return;
    }

    printSessionHeader(change.mode, toolSurface(change.mode));
    printNotice(skillStatusLine());
    printRestartNotice(change);

    if (verbose) {
        printHint(`Permission mode now: ${MODES[change.mode].permissionMode}`);
    }
}

function printRestartNotice(change: ModeSwitch): void {
    if (!change.restarted) {
        return;
    }

    const history = change.resumedHistory
        ? "Conversation history resumed."
        : "New conversation: no earlier session id to resume.";
    printNotice(
        `${change.mode} mode needs tools this session did not start with, so the session restarted. ${history}`,
    );
}

async function attemptModeSwitch(
    session: AgentSession,
    requestedMode: Mode,
): Promise<ModeSwitch | null> {
    try {
        return await switchMode(session, requestedMode);
    } catch (error) {
        printFailure(
            `Could not restart the session for ${requestedMode} mode: ${describeError(error)}. The previous session was closed.`,
        );
        return null;
    }
}

async function switchModelCommand(argument: string, session: AgentSession): Promise<void> {
    if (argument) {
        await setModelDirect(argument, session);
        printSessionHeader(session.mode, toolSurface(session.mode));
        printNotice(skillStatusLine());
        return;
    }
    await runModelSwitch(session);
    printSessionHeader(session.mode, toolSurface(session.mode));
    printNotice(skillStatusLine());
}

async function printContextUsage(session: AgentSession): Promise<void> {
    try {
        const usage = await session.query.getContextUsage();
        printContextReport({
            totalTokens: usage.totalTokens,
            maxTokens: usage.maxTokens,
            categories: usage.categories.map((category) => ({
                label: category.name,
                value: String(category.tokens),
            })),
        });
} catch (error) {
        printFailure(`Context usage is not available for this session: ${describeError(error)}`);
    }
}