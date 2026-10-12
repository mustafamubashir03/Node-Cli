import { input } from "@inquirer/prompts";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { fmt } from "../ui/format.js";
import { handleMessage } from "../agent/message-handler.js";
import {
    CliModeToPermissionMode,
    parseCliMode,
    setCurrentMode,
    type Climode,
} from "../agent/modes.js";
import { SLASH_COMMANDS } from "../config/constants.js";
import { startSpinner, stopSpinner } from "../ui/spinner.js";
import { createSession, recreateSession, needsRecreation, type AgentSession } from "../agent/create-session.js";

export type ChatOptions = {
    mode?: Climode;
    verbose?: boolean;
}

function printModeHeader(session: AgentSession): void {
    console.log(fmt.mode(`Chatting with Node Cli in ${session.mode} mode`));
}

function printSlashHelp(): void {
    console.log(fmt.label("Available slash commands"));
    for (const { command, description } of SLASH_COMMANDS) {
        console.log(fmt.dim(`${command.padEnd(22)} | ${description}`));
    }
    console.log();
}

export async function drainUntilResult(
    stream: AsyncIterator<SDKMessage>,
    onMessage: (message: SDKMessage) => void
): Promise<void> {
    for (; ;) {
        const { value, done } = await stream.next();
        if (done) return;
        onMessage(value);
        if (value.type === "result") return;
    }
}

async function handleSlashCommand(
    line: string,
    session: AgentSession,
    verbose: boolean
): Promise<{ handled: boolean; newMode?: Climode }> {
    const trimmed = line.trim();
    const lower = trimmed.toLowerCase();

    if (lower === "/help") {
        printSlashHelp();
        return { handled: true };
    }

    if (lower === "/context") {
        try {
            const usage = await session.query.getContextUsage();
            const total = (usage as any)?.total_tokens ?? (usage as any)?.totalTokens;
            const window = (usage as any)?.context_window_size ?? (usage as any)?.contextWindowSize;
            if (total !== undefined) {
                console.log(fmt.info(`Context usage: ${total}${window ? ` / ${window}` : ""} tokens`));
            } else {
                console.log(fmt.info(`Context usage: ${JSON.stringify(usage)}`));
            }
        } catch {
            console.log(fmt.error("Context usage not available for this session"));
        }
        return { handled: true };
    }

    if (lower.startsWith("/mode ")) {
        const parts = trimmed.split(/\s+/);
        const modeArg = parts[1];
        if (!modeArg) {
            console.log(fmt.error("Usage: /mode <agent|ask|plan>"));
            return { handled: true };
        }
        const newMode = parseCliMode(modeArg);
        if (!newMode) {
            console.log(fmt.error(`Unknown mode: ${modeArg}. Use agent, ask, or plan.`));
            return { handled: true };
        }
        if (needsRecreation(session, newMode)) {
            const hadHistory = Boolean(session.sessionId);
            console.log(
                fmt.info(`${newMode} mode needs tools this session was not started with - restarting the session...`),
            );
            try {
                await recreateSession(session, newMode);
            } catch (error) {
                console.error(
                    fmt.error(
                        `Could not restart the session for ${newMode} mode: ${error}. The previous session was closed.`,
                    ),
                );
                return { handled: true };
            }
            setCurrentMode(newMode);
            printModeHeader(session);
            const history = hadHistory
                ? "Conversation history resumed"
                : "New conversation (no prior session id to resume)";
            console.log(fmt.dim(`${history}. Tools: ${session.initialTools.join(", ")}`));
            return { handled: true, newMode };
        }

        await session.query.setPermissionMode(CliModeToPermissionMode(newMode));
        session.mode = newMode;
        setCurrentMode(newMode);
        printModeHeader(session);
        console.log(fmt.dim(`Tools: ${session.mode === "agent" ? "Read, Grep, Glob, Edit, Write, Bash" : "Read, Grep, Glob, WebSearch, WebFetch (read-only)"}`));
        if (verbose) {
            console.log(fmt.dim(`Permission mode now: ${CliModeToPermissionMode(newMode)}`));
        }
        return { handled: true, newMode };
    }

    if (lower.startsWith("/")) {
        console.log(fmt.warn(`Unknown slash command: ${trimmed}. Type /help for available commands.`));
        return { handled: true };
    }

    return { handled: false };
}

export async function startChat(options: ChatOptions): Promise<void> {
    const { mode: initialMode = "agent", verbose = false } = options;
    const session = createSession(initialMode);
    printModeHeader(session);
    console.log(fmt.dim("Enter /help to see available commands"));
    printSlashHelp();

    let running = true;
    let isShuttingDown = false;

    const shutdown = async () => {
        if (isShuttingDown) return;
        isShuttingDown = true;
        running = false;
        stopSpinner();
        session.inputQueue.close();
        try {
            await session.query.interrupt();
        } catch { }
        try {
            await session.query.return();
        } catch { }
        console.log(fmt.dim("Goodbye!"));
        setTimeout(() => process.exit(0), 1500).unref();
        process.exit(0);
    };

    const sigintHandler = () => {
        shutdown();
    };

    process.on("SIGINT", sigintHandler);

    try {
        while (running) {
            let line: string;
            try {
                line = await input({ message: fmt.label("You:") });
            } catch {
                await shutdown();
                break;
            }

            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            const lower = trimmed.toLowerCase();
            if (lower === "/exit") {
                await shutdown();
                break;
            }

            if (lower === "/clear") {
                console.clear();
                console.log(fmt.dim("Console cleared."));
                continue;
            }

            const slash = await handleSlashCommand(trimmed, session, verbose);
            if (slash.handled) {
                if (slash.newMode) {
                    session.mode = slash.newMode;
                    setCurrentMode(slash.newMode);
                }
                continue;
            }

            startSpinner("Agent working...");
            session.inputQueue.push(trimmed);
            try {
                await drainUntilResult(session.stream, (message) => {
                    if (message.type === "system" && message.subtype === "init") {
                        session.sessionId = message.session_id;
                    }
                    handleMessage(message, { verbose });
                });
            } catch (error) {
                console.error(fmt.error(`Session error: ${error}`));
            } finally {
                stopSpinner();
            }
        }
    } finally {
        process.removeListener("SIGINT", sigintHandler);
    }
}