const SECRET_ENV_NAME = /(?:^|_)(?:API_?KEY|AUTH_?TOKEN|ACCESS_?TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE_?KEY|SESSION_?TOKEN)(?:$|_)/i;

const REDACTED = "[REDACTED]";

const VALUE_PATTERNS: RegExp[] = [
    // OpenAI, OpenRouter, Anthropic and similar API keys.
    /\bsk-(?:or-|ant-)?[A-Za-z0-9_-]{8,}\b/g,
    /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{8,}\b/g,
    // Bearer and basic authorization headers.
    /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
    // Common key/value representations in errors and JSON.
    /((?:"|')?(?:api[_-]?key|auth[_-]?token|access[_-]?token|refresh[_-]?token|secret|password|passwd|credential|authorization|x-api-key)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}\]]+)/gi,
    // JSON Web Tokens.
    /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

export function secretValues(env: NodeJS.ProcessEnv = process.env): string[] {
    const values: string[] = [];
    for (const [name, value] of Object.entries(env)) {
        if (!value || value.length < 6) continue;
        if (!SECRET_ENV_NAME.test(name)) continue;
        values.push(value);
    }
    // Longest first so a value that contains another value is fully removed.
    return values.sort((a, b) => b.length - a.length);
}

/**
 * Removes credentials and secret-bearing fields from text that may be shown in
 * the terminal, written to a log, or included in an error message. Never use
 * this as a substitute for not collecting secrets in the first place.
 */
export function redactSecrets(text: string, env: NodeJS.ProcessEnv = process.env): string {
    if (!text) return text;

    let result = text;
    for (const value of secretValues(env)) {
        result = result.split(value).join(REDACTED);
    }

    for (const pattern of VALUE_PATTERNS) {
        result = result.replace(pattern, (match, prefix?: string) => {
            if (prefix && typeof prefix === "string") {
                return `${prefix}${REDACTED}`;
            }
            if (/^(Bearer|Basic)\s/i.test(match)) {
                return `${match.split(/\s+/)[0]} ${REDACTED}`;
            }
            return REDACTED;
        });
    }

    return result;
}

/** Serializes a value for diagnostics with secret-looking fields removed. */
export function redactForDiagnostics(value: unknown): string {
    const seen = new WeakSet<object>();
    try {
        return JSON.stringify(
            value,
            (key, current) => {
                if (SECRET_ENV_NAME.test(key)) {
                    return REDACTED;
                }
                if (typeof current === "object" && current !== null) {
                    if (seen.has(current)) return "[Circular]";
                    seen.add(current);
                }
                if (typeof current === "string") {
                    return redactSecrets(current);
                }
                return current;
            },
            2,
        );
    } catch (error) {
        return redactSecrets(error instanceof Error ? error.message : String(error));
    }
}

export function redactError(error: unknown): string {
    return redactSecrets(error instanceof Error ? error.message : String(error));
}
