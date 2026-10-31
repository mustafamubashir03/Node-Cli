import chalk from "chalk";

export const style = {
    agent: (text: string) => chalk.cyan(text),
    tool: (text: string) => chalk.blueBright(text),
    toolResult: (text: string) => chalk.green(text),
    success: (text: string) => chalk.green(text),
    error: (text: string) => chalk.red(text),
    warning: (text: string) => chalk.yellow(text),
    info: (text: string) => chalk.cyan(text),
    mode: (text: string) => chalk.magenta(text),
    dim: (text: string) => chalk.dim(text),
    bold: (text: string) => chalk.bold(text),
};

export function truncate(text: string, limit: number): string {
    return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}