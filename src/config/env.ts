import chalk from "chalk";
import { config } from "dotenv";
import { execa } from "execa";

// A ./.env wins, so a project can override the bundled defaults. The package's own
// .env is the fallback: when the CLI is run from an installed location the cwd is
// the user's project, not this directory.
config();
config({ path: new URL("../../.env", import.meta.url) });

export function requireApiKey(): string {
    // Local Ollama (or any custom endpoint): a real Anthropic key isn't needed
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
    console.log(chalk.green("✓ API key loaded"));
}