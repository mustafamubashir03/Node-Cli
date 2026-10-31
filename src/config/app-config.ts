import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".node-cli.json");

export type AppConfig = {
    selectedModel?: string;
    purchasedCredits?: boolean;
    skills?: string[];
    maxBudgetUsd?: number;
    /** Additional directories outside the workspace root where writes are allowed. */
    writeAllowList?: string[];
};

export function readAppConfig(): AppConfig {
    if (!existsSync(CONFIG_PATH)) {
        return {};
    }
    try {
        return JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as AppConfig;
    } catch {
        return {};
    }
}

export function writeAppConfig(updates: Partial<AppConfig>): void {
    const current = readAppConfig();
    writeFileSync(CONFIG_PATH, JSON.stringify({ ...current, ...updates }, null, 2));
}