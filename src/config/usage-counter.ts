import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readAppConfig } from "./app-config.js";
import type { ProviderFailure } from "../agent/provider-errors.js";

const DEFAULT_USAGE_PATH = join(homedir(), ".node-cli-usage.json");

const MINUTE_LIMIT = 20;
const DAY_LIMIT_FREE = 50;
const DAY_LIMIT_PURCHASED = 1000;
const WARN_RATIO = 0.8;

type UsageStore = {
    minute: { count: number; resetAt: number };
    day: { count: number; resetAt: number };
    blockedUntil?: number;
    blockedReason?: string;
};

function usagePath(): string {
    return process.env.NODE_CLI_USAGE_PATH || DEFAULT_USAGE_PATH;
}

function now(): number {
    return Date.now();
}

function loadStore(): UsageStore {
    if (!existsSync(usagePath())) {
        return { minute: { count: 0, resetAt: 0 }, day: { count: 0, resetAt: 0 } };
    }
    try {
        return JSON.parse(readFileSync(usagePath(), "utf8")) as UsageStore;
    } catch {
        return { minute: { count: 0, resetAt: 0 }, day: { count: 0, resetAt: 0 } };
    }
}

function saveStore(store: UsageStore): void {
    try {
        writeFileSync(usagePath(), JSON.stringify(store, null, 2));
    } catch {
        return;
    }
}

function resetIfNeeded(store: UsageStore): UsageStore {
    const nowMs = now();
    let changed = false;
    if (nowMs >= store.minute.resetAt) {
        store.minute = { count: 0, resetAt: nowMs + 60_000 };
        changed = true;
    }
    if (nowMs >= store.day.resetAt) {
        store.day = { count: 0, resetAt: nowMs + 86_400_000 };
        changed = true;
    }
    if (changed) {
        saveStore(store);
    }
    return store;
}

export type CounterResult = {
    allowed: boolean;
    minuteWarning?: string;
    dayWarning?: string;
    minuteRemaining?: number;
    dayRemaining?: number;
};

export function checkRequestGate(): CounterResult {
    const store = resetIfNeeded(loadStore());
    if (store.blockedUntil && store.blockedUntil > now()) {
        return {
            allowed: false,
            minuteWarning: store.blockedReason ?? "The provider asked us to wait before retrying.",
        };
    }
    if (store.blockedUntil) {
        delete store.blockedUntil;
        delete store.blockedReason;
        saveStore(store);
    }
    return { allowed: true };
}

export function recordProviderFailure(failure: ProviderFailure): void {
    if (failure.kind !== "rate_limit" && failure.kind !== "quota" && failure.kind !== "auth") {
        return;
    }

    const store = resetIfNeeded(loadStore());
    const defaultDelay = failure.kind === "rate_limit" ? 60_000 : failure.kind === "quota" ? 30 * 60_000 : 5 * 60_000;
    const delay = Math.min(Math.max(failure.retryAfterMs ?? defaultDelay, 1_000), 24 * 60 * 60_000);
    store.blockedUntil = now() + delay;
    store.blockedReason =
        failure.kind === "rate_limit"
            ? `Provider rate limit is active. Retry in ${formatDelay(delay)}; the same request was not resent.`
            : failure.kind === "quota"
              ? `Provider quota is exhausted. Add credits or change model, then retry in ${formatDelay(delay)}.`
              : "Authentication failed. Fix the provider key with `node-cli setup` or `node-cli doctor`; retrying unchanged will not help.";
    saveStore(store);
}

export function recordRequest(): CounterResult {
    const store = resetIfNeeded(loadStore());
    const purchased = readAppConfig().purchasedCredits === true;
    const dayLimit = purchased ? DAY_LIMIT_PURCHASED : DAY_LIMIT_FREE;

    if (store.blockedUntil && store.blockedUntil > now()) {
        return {
            allowed: false,
            minuteWarning: store.blockedReason ?? "The provider asked us to wait before retrying.",
        };
    }
    if (store.blockedUntil) {
        delete store.blockedUntil;
        delete store.blockedReason;
    }

    store.minute.count += 1;
    store.day.count += 1;
    saveStore(store);

    const result: CounterResult = { allowed: true };

    if (store.minute.count > MINUTE_LIMIT) {
        result.allowed = false;
        result.minuteWarning = `Free tier limit: 20 requests per minute. You've made ${store.minute.count} this minute. Wait until the minute resets.`;
    } else if (store.minute.count >= Math.ceil(MINUTE_LIMIT * WARN_RATIO)) {
        result.minuteWarning = `Approaching the free tier limit: ${store.minute.count} / ${MINUTE_REQUESTS} requests this minute.`;
    }

    const dayRemaining = dayLimit - store.day.count;
    result.dayRemaining = dayRemaining > 0 ? dayRemaining : 0;
    if (store.day.count >= dayLimit) {
        result.allowed = false;
        result.dayWarning = `Daily free tier limit reached: ${store.day.count} / ${dayLimit} requests today.`;
    } else if (store.day.count >= Math.ceil(dayLimit * WARN_RATIO)) {
        result.dayWarning = `Approaching the daily free tier limit: ${store.day.count} / ${dayLimit} requests today.`;
    }

    return result;
}

const MINUTE_REQUESTS = MINUTE_LIMIT;

function formatDelay(ms: number): string {
    const seconds = Math.ceil(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    return `${Math.ceil(seconds / 60)}m`;
}

export function usageSnapshot(): { minute: number; day: number; dayLimit: number } {
    const store = resetIfNeeded(loadStore());
    const purchased = readAppConfig().purchasedCredits === true;
    return {
        minute: store.minute.count,
        day: store.day.count,
        dayLimit: purchased ? DAY_LIMIT_PURCHASED : DAY_LIMIT_FREE,
    };
}