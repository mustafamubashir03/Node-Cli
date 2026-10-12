import { Command } from "commander";
import { printBanner } from "./ui/banner.js";
import { checkEnvironment, requireApiKey } from "./config/env.js";
import { runQuery } from "./agent/run-query.js";
import { Climode, parseCliMode } from "./agent/modes.js";
import { startChat } from "./commands/chat.js";
import { wakeUp } from "./commands/wake-up.js";


export function createCli() {
    const program = new Command().name("node-cli").description("A cli tool to help u start your project").version("0.1.0");
    program.command("talk").description("Talk to Node Cli").argument("<prompt>", "The prompt to send to Claude").option("-v, --verbose", "Enable verbose output").action(async (prompt: string, options: { verbose?: boolean }) => {
        requireApiKey()
        await runQuery(prompt, options)
    })
    program.command('wake-up').description('Banner, preflight, mode picker, then chat').action(async () => {
        await wakeUp()
    })
    program.command('run').description('send a one-shot prompt to Node Cli').argument('<prompt>', "What to ask Node Cli...").option("-m, --mode <value>", "The mode to use: agent|ask|plan", parseMode, "agent").option("-v, --verbose", "Enable verbose output", false).action(async (prompt: string, options: { mode?: string, verbose?: boolean }) => {
        requireApiKey()
        await runQuery(prompt, { mode: parseMode(options.mode as string), verbose: options.verbose })
    })
    program.command("chat").description("Interactive streaming chat session").option("-m, --mode <mode>", "agent | ask | plan", parseMode, "agent").option("-v, --verbose", "Show agent loop message type", false).action(async (options: { mode?: string, verbose?: boolean }) => {
        requireApiKey()
        await startChat({ mode: parseMode(options.mode as string), verbose: options.verbose })
    })
    program.command("banner").description("Show the banner").action(() => {
        printBanner()
    })
    program.command("doctor").description("Check your environment").action(async () => {
        await checkEnvironment()
    })
    program.command('help').action(() => {
        printBanner()
        program.help()
    })
    return program;
}


function parseMode(value: string): Climode {
    const mode = parseCliMode(value)
    if (!mode) {
        throw new Error(`Invalid mode: ${value}. Use agent, ask, or plan.`)
    }
    return mode
}