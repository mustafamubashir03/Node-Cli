import { select } from "@inquirer/prompts";
import { ALL_MODES, MODES, type Mode } from "../agent/modes.js";
import { startChat } from "./chat.js";
import { runDoctor } from "./doctor.js";
import { promptForCredentials } from "../config/setup.js";
import { isMissingCredentials } from "../config/env.js";
import { printBanner } from "../ui/banner.js";
import {
    describeError,
    printFailure,
    printHint,
    printModeCards,
    printNotice,
    printSuccess,
    type ModeCard,
} from "../ui/messages.js";
import { exportDesignTokens } from "../ui/design-tokens.js";
import { runVisualQASummary } from "../ui/visual-qa.js";

const MODE_BORDER_COLORS: Record<Mode, string> = {
    agent: "green",
    ask: "blue",
    plan: "yellow",
    strict: "magenta",
};

export async function wakeUp(options: { exportDesignTokens?: boolean; visualQA?: boolean } = {}): Promise<void> {
    printBanner();
    console.log();

    try {
        await runDoctor();
    } catch (error) {
        if (isMissingCredentials(error)) {
            printNotice("No API key was found. Let's set one up.");
            await promptForCredentials();
            printSuccess("Key saved to .env.");
            printHint("Run node-cli wake-up again to start chatting.");
            return;
        }
        printFailure(describeError(error));
        printHint("Copy .env.example to .env, add your key, then run node-cli wake-up again.");
        process.exit(1);
    }

    console.log();
    printModeCards(
        ALL_MODES.map(
            (mode): ModeCard => ({
                mode,
                description: MODES[mode].description,
                borderColor: MODE_BORDER_COLORS[mode],
            }),
        ),
    );

    const mode = await pickModeOrQuit();
    if (!mode) {
        return;
    }
    console.log();

    if (options.exportDesignTokens) {
        const tokens = exportDesignTokens(mode, []);
        console.log(JSON.stringify(tokens, null, 2));
        return;
    }

    if (options.visualQA) {
        const readiness = await runVisualQASummary();
        if (!readiness.ready) process.exitCode = 1;
        return;
    }

    await startChat({ mode });
}

async function pickModeOrQuit(): Promise<Mode | null> {
    try {
        return await select<Mode>({
            message: "Choose a mode to start: ",
            choices: ALL_MODES.map((mode) => ({
                name: `${mode} - ${MODES[mode].description}`,
                value: mode,
            })),
            default: "agent",
        });
    } catch {
        printHint("No mode chosen. Exiting.");
        return null;
    }
}
