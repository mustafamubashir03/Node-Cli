import chalk from "chalk";
import { config } from "dotenv";
import { execa } from "execa";
import { homedir } from "node:os";
import { join } from "node:path";

config();
config({ path: join(homedir(), ".node-cli.env") });
config({ path: new URL("../../.env", import.meta.url) });

export function requireApiKey(): string {
    if (process.env.ANTHROPIC_BASE_URL) {
        return process.env.ANTHROPIC_AUTH_TOKEN ?? process.env.ANTHROPIC_API_KEY ?? "ollama";
    }

    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
        throw new Error("ANTHROPIC_API_KEY is not defined.");
    }
    return key;
}

export async function checkEnvironment(): Promise<void> {
    const { stdout } = await execa("node", ["-v"])
    const nodeVersion = stdout.trim();
    if (nodeVersion < "18.0.0") {
        throw new Error("Node version must be >= 18")
    }
    requireApiKey();
    console.log(chalk.green(`✓ Node version: ${nodeVersion}`));
    console.log(chalk.green(`✓ API key loaded`));
}