import { config as loadDotEnvFile } from "dotenv";
import { homedir } from "node:os";
import { join } from "node:path";

export const GLOBAL_CREDENTIAL_FILE = ".node-cli.env";

export const MINIMUM_NODE_MAJOR = 18;

export const CREDENTIAL_VARIABLES = [
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
] as const;

export const MISSING_CREDENTIALS_MESSAGE =
    `No credentials found. Put ${CREDENTIAL_VARIABLES.join(" or ")} in a .env file.`;

export type Credential = {
    variable: string;
    value: string;
};

export function loadEnvironment(): void {
    loadDotEnvFile({ quiet: true });
    loadDotEnvFile({ path: join(homedir(), GLOBAL_CREDENTIAL_FILE), quiet: true });
    loadDotEnvFile({ path: new URL("../../.env", import.meta.url), quiet: true });
}

export function currentNodeVersion(): string {
    return process.versions.node;
}

export function requireSupportedNodeVersion(): string {
    const version = currentNodeVersion();
    const major = Number.parseInt(version.split(".")[0] ?? "", 10);
    if (!Number.isFinite(major) || major < MINIMUM_NODE_MAJOR) {
        throw new Error(
            `Node ${MINIMUM_NODE_MAJOR} or newer is required. This machine runs Node ${version}.`,
        );
    }
    return version;
}

export function findCredential(): Credential | null {
    for (const variable of CREDENTIAL_VARIABLES) {
        const value = process.env[variable];
        if (value) {
            return { variable, value };
        }
    }
    return null;
}

export function requireCredentials(): Credential {
    const credential = findCredential();
    if (!credential) {
        throw new Error(MISSING_CREDENTIALS_MESSAGE);
    }
    return credential;
}

export function isMissingCredentials(error: unknown): boolean {
    return error instanceof Error && error.message === MISSING_CREDENTIALS_MESSAGE;
}