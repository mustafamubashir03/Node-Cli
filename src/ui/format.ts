import chalk from "chalk";

export const fmt = {
    system: (t: string) => chalk.gray(`System: ${t}`),
    assistant: (t: string) => chalk.cyan(`Agent: ${t}`),
    user: (t: string) => chalk.whiteBright(`User: ${t}`),
    tool: (t: string) => chalk.blueBright(`Tool Call: ${t}`),
    toolResult: (t: string) => chalk.green(`Tool Result: ${t}`),
    success: (t: string) => chalk.green(`Success: ${t}`),
    error: (t: string) => chalk.red(`Error: ${t}`),
    dim: (t: string) => chalk.dim(t),
    warn: (t: string) => chalk.yellow(`Warning: ${t}`),
    info: (t: string) => chalk.cyan(`Info: ${t}`),
    mode: (t: string) => chalk.magenta(`Mode: ${t}`),
    label: (t: string) => chalk.bold(t),
    truncate: (t: string, len: number) => t.length > len ? t.slice(0, len) + "..." : t,
    diff: (added: string, removed: string) => {
        let result = ""
        if (added) {
            result += chalk.green(added)
        }
        if (removed) {
            result += chalk.red(removed)
        }
        return result
    }
}

export function truncate(text: string, len: number): string {
    if (text.length <= len) {
        return text;
    }
    return text.slice(0, len) + "...";
}

function printDiff(added: string, removed: string) {
    if (added) {
        console.log(chalk.green(added))
    }
    if (removed) {
        console.log(chalk.red(removed))
    }
}