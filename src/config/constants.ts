import type { Climode } from "../agent/modes.ts";

export const CLI_MODES: Climode[] = ["agent", "ask", "plan"]

export const MODE_DESCRIPTIONS: Record<Climode, string> = {
    agent: "Read, edit, and run commands - full agent loop with tools",
    ask: "Ready only exploration, answer without changing the files",
    plan: "Explore and propose a plan. No file edits applied. Think first, then execute as agent"
}


export const SLASH_COMMANDS = [
    { command: "/mode <agent|ask|plan>", description: "switch the mode" },
    { command: "/help", description: "show help" },
    { command: "/context", description: "show context window usage" },
    { command: "/clear", description: "clear the context" },
    { command: "/exit", description: "exit the cli" },
]