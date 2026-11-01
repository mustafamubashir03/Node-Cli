import { readAppConfig } from "./app-config.js";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api";

export const FALLBACK_MODEL = "poolside/laguna-s-2.1:free";

export const FAST_MODEL = "poolside/laguna-xs-2.1:free";

export function maxBudgetUsd(): number | undefined {
    const raw = process.env.MAX_BUDGET_USD ?? readAppConfig().maxBudgetUsd;
    if (raw === undefined || raw === null || String(raw).trim() === "") return undefined;
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return undefined;
}

// Backwards-compatible constant for callers/tests that read the default.
export const MAX_BUDGET_USD = undefined;

export const REASONING_EFFORT = "medium";

export function primaryModel(): string {
    return process.env.AGENT_MODEL ?? readAppConfig().selectedModel ?? FALLBACK_MODEL;
}