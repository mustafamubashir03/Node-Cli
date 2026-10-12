import { CLI_MODES, MODE_DESCRIPTIONS } from "../agent/modes.js";

export { CLI_MODES, MODE_DESCRIPTIONS };

export const SLASH_COMMANDS = [
    { command: "/mode <agent|ask|plan>", description: "switch the mode" },
    { command: "/help", description: "show help" },
    { command: "/context", description: "show context window usage" },
    { command: "/clear", description: "clear the console" },
    { command: "/exit", description: "exit the cli" },
];