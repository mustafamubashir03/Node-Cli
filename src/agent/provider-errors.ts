import { redactSecrets } from "../security/redact.js";

export type ProviderFailureKind =
    | "rate_limit"
    | "quota"
    | "auth"
    | "tool_schema"
    | "context_length"
    | "budget"
    | "model_unavailable"
    | "network"
    | "server"
    | "unknown";

export type ProviderFailure = {
    kind: ProviderFailureKind;
    retryable: boolean;
    status: number | null;
    retryAfterMs: number | null;
    message: string;
    action: string;
};

type ErrorLike = {
    status?: unknown;
    statusCode?: unknown;
    code?: unknown;
    retryAfter?: unknown;
    retry_after?: unknown;
    response?: { status?: unknown; headers?: { get?: (name: string) => string | null } };
    cause?: unknown;
};

const AUTH_PATTERN =
    /\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?api[ _-]?key|api key.*(?:invalid|revoked|expired)|authentication|permission denied/i;
const QUOTA_PATTERN =
    /insufficient[ _-]?(?:quota|credit|balance)|quota (?:exceeded|exhausted|reached)|credit balance|out of credits|\b402\b|daily (?:free )?(?:limit|allowance).*(?:reached|exhausted)|monthly (?:limit|allowance).*(?:reached|exhausted)/i;
const RATE_LIMIT_PATTERN = /\b429\b|rate[ _-]?limit|too many requests|temporarily throttled/i;
const TOOL_SCHEMA_PATTERN =
    /tool[ _-]?(?:schema|definition|choice)|function[ _-]?(?:schema|definition|calling).*(?:invalid|unsupported|not supported)|invalid[ _-]?(?:tool|function)|does not support tools|tools are not supported|unsupported tool/i;
const CONTEXT_PATTERN =
    /context[ _-]?(?:length|window|limit)|maximum context|prompt is too long|too many tokens|token limit/i;
const BUDGET_PATTERN = /maximum budget|budget (?:exceeded|exhausted)|maxBudgetUsd|budget_exhausted/i;
const MODEL_PATTERN =
    /model (?:not found|unavailable|does not exist|is not available)|no endpoints found|unknown model|invalid model/i;
const NETWORK_PATTERN =
    /\b(ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE)\b|fetch failed|network error|socket hang up|connection (?:reset|refused|closed|error)|timeout|timed out/i;
const SERVER_PATTERN = /\b(500|502|503|504|529)\b|internal server error|bad gateway|service unavailable|gateway timeout|overloaded/i;

export function classifyProviderFailure(error: unknown): ProviderFailure {
    const raw = errorText(error);
    const text = redactSecrets(raw);
    const status = extractStatus(error);
    const retryAfterMs = extractRetryAfterMs(error);

    if (status === 401 || status === 403 || AUTH_PATTERN.test(text)) {
        return failure("auth", false, status, retryAfterMs, text, "Authentication failed. Check that the provider key is valid and has not been revoked, then run `node-cli doctor`.");
    }
    if (QUOTA_PATTERN.test(text)) {
        return failure("quota", false, status, retryAfterMs, text, "The provider quota or credit balance is exhausted. Add credits or switch to a provider/model with remaining quota; retrying the same request will not help.");
    }
    if (status === 429 || RATE_LIMIT_PATTERN.test(text)) {
        return failure("rate_limit", true, status, retryAfterMs, text, "The provider is rate limiting requests. Wait for the retry window, then try once. Do not resend the same request immediately.");
    }
    if (TOOL_SCHEMA_PATTERN.test(text)) {
        return failure("tool_schema", false, status, retryAfterMs, text, "This provider/model rejected the tool schema or tool calling. Switch to a model that supports the configured tools; resending the same request will fail identically.");
    }
    if (CONTEXT_PATTERN.test(text)) {
        return failure("context_length", false, status, retryAfterMs, text, "The conversation exceeds the model context window. Start a new session or reduce the input.");
    }
    if (BUDGET_PATTERN.test(text)) {
        return failure("budget", false, status, retryAfterMs, text, "The configured spending budget was reached. Adjust the budget deliberately if you want to continue.");
    }
    if (MODEL_PATTERN.test(text)) {
        return failure("model_unavailable", false, status, retryAfterMs, text, "The selected model is unavailable. Choose another model with /model.");
    }
    if (status !== null && status >= 500) {
        return failure("server", true, status, retryAfterMs, text, "The provider returned a temporary server error. The SDK applies bounded retries; if it keeps failing, wait before trying again.");
    }
    if (NETWORK_PATTERN.test(text)) {
        return failure("network", true, status, retryAfterMs, text, "The provider could not be reached because of a network error. Check connectivity; the SDK applies bounded retries.");
    }
    if (status === 400 || status === 422) {
        return failure("tool_schema", false, status, retryAfterMs, text, "The provider rejected the request as invalid. Check the selected model's tool support and the request configuration before retrying.");
    }

    return failure("unknown", false, status, retryAfterMs, text, "The request failed. Review the error above before retrying; repeating an unchanged request may fail identically.");
}

export function formatProviderFailure(failure: ProviderFailure): string {
    const provider = "OpenRouter";
    const status = failure.status ? ` (HTTP ${failure.status})` : "";
    return `${provider} ${labelFor(failure.kind)}${status}: ${shorten(failure.message)}\n${failure.action}`;
}

function labelFor(kind: ProviderFailureKind): string {
    switch (kind) {
        case "rate_limit":
            return "rate limit";
        case "quota":
            return "quota exhausted";
        case "auth":
            return "authentication error";
        case "tool_schema":
            return "tool schema error";
        case "context_length":
            return "context length error";
        case "budget":
            return "budget limit reached";
        case "model_unavailable":
            return "model unavailable";
        case "network":
            return "network error";
        case "server":
            return "server error";
        default:
            return "request failed";
    }
}

function failure(
    kind: ProviderFailureKind,
    retryable: boolean,
    status: number | null,
    retryAfterMs: number | null,
    message: string,
    action: string,
): ProviderFailure {
    return { kind, retryable, status, retryAfterMs, message, action };
}

function errorText(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error as Error & { cause?: unknown }).cause;
        return cause && cause !== error ? `${error.message} ${errorText(cause)}` : error.message;
    }
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
        const candidate = error as { message?: unknown; error?: unknown; body?: unknown };
        if (typeof candidate.message === "string") return candidate.message;
        if (typeof candidate.error === "string") return candidate.error;
        try {
            return JSON.stringify(error);
        } catch {
            return String(error);
        }
    }
    return String(error);
}

function extractStatus(error: unknown): number | null {
    if (!error || typeof error !== "object") return null;
    const candidate = error as ErrorLike;
    for (const value of [candidate.status, candidate.statusCode, candidate.response?.status]) {
        const parsed = Number(value);
        if (Number.isInteger(parsed) && parsed >= 100 && parsed <= 599) return parsed;
    }
    const text = errorText(error);
    const match = text.match(/\b(?:HTTP|status(?:_code)?|code)?\s*[:=]?\s*(4\d{2}|5\d{2})\b/i);
    return match ? Number(match[1]) : null;
}

function extractRetryAfterMs(error: unknown): number | null {
    if (!error || typeof error !== "object") return null;
    const candidate = error as ErrorLike;
    const header = candidate.response?.headers?.get?.("retry-after");
    const raw = header ?? candidate.retryAfter ?? candidate.retry_after;
    if (raw === undefined || raw === null) {
        const text = errorText(error);
        const seconds = text.match(/retry[ _-]?after["']?\s*[:=]?\s*(\d+)/i);
        return seconds ? Math.min(Number(seconds[1]) * 1000, 24 * 60 * 60 * 1000) : null;
    }
    const asNumber = Number(raw);
    if (Number.isFinite(asNumber)) return Math.min(Math.max(asNumber * 1000, 0), 24 * 60 * 60 * 1000);
    const asDate = Date.parse(String(raw));
    if (Number.isFinite(asDate)) return Math.min(Math.max(asDate - Date.now(), 0), 24 * 60 * 60 * 1000);
    return null;
}

function shorten(message: string): string {
    const line = message.split("\n").map((part) => part.trim()).find(Boolean) ?? "unknown error";
    return line.length <= 240 ? line : `${line.slice(0, 240)}...`;
}
