import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyProviderFailure, formatProviderFailure } from "./provider-errors.js";

test("classifies an authentication failure as non-retryable", () => {
    const failure = classifyProviderFailure(Object.assign(new Error("Unauthorized"), { status: 401 }));
    assert.equal(failure.kind, "auth");
    assert.equal(failure.retryable, false);
    assert.equal(failure.status, 401);
    assert.match(failure.action, /node-cli doctor/);
});

test("classifies a 403 as auth even without a message", () => {
    const failure = classifyProviderFailure({ statusCode: 403 });
    assert.equal(failure.kind, "auth");
});

test("classifies exhausted credits as quota, not a transient rate limit", () => {
    const failure = classifyProviderFailure(
        new Error("402 Payment Required: insufficient credits for this request"),
    );
    assert.equal(failure.kind, "quota");
    assert.equal(failure.retryable, false);
    assert.match(failure.action, /credits/i);
});

test("classifies 429 as a retryable rate limit with Retry-After", () => {
    const error = Object.assign(new Error("Too Many Requests"), {
        status: 429,
        response: { headers: { get: (name: string) => (name === "retry-after" ? "30" : null) } },
    });
    const failure = classifyProviderFailure(error);
    assert.equal(failure.kind, "rate_limit");
    assert.equal(failure.retryable, true);
    assert.equal(failure.retryAfterMs, 30_000);
});

test("classifies tool-schema rejection so the request is not repeated", () => {
    const failure = classifyProviderFailure(
        new Error("This model does not support tools or function calling"),
    );
    assert.equal(failure.kind, "tool_schema");
    assert.equal(failure.retryable, false);
    assert.match(failure.action, /switch to a model/i);
});

test("classifies context-length errors", () => {
    const failure = classifyProviderFailure(new Error("maximum context length exceeded"));
    assert.equal(failure.kind, "context_length");
    assert.equal(failure.retryable, false);
});

test("classifies budget exhaustion", () => {
    const failure = classifyProviderFailure(new Error("Maximum budget exceeded for this session"));
    assert.equal(failure.kind, "budget");
});

test("classifies an unavailable model", () => {
    const failure = classifyProviderFailure(new Error("model not found: poolside/missing"));
    assert.equal(failure.kind, "model_unavailable");
    assert.match(failure.action, /\/model/);
});

test("classifies transient network failures as retryable", () => {
    const failure = classifyProviderFailure(
        new TypeError("fetch failed", { cause: Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }) }),
    );
    assert.equal(failure.kind, "network");
    assert.equal(failure.retryable, true);
});

test("classifies 5xx responses as retryable server errors", () => {
    const failure = classifyProviderFailure(Object.assign(new Error("Bad Gateway"), { status: 502 }));
    assert.equal(failure.kind, "server");
    assert.equal(failure.retryable, true);
});

test("does not repeat an unchanged unknown request", () => {
    const failure = classifyProviderFailure(new Error("something unexpected happened"));
    assert.equal(failure.kind, "unknown");
    assert.equal(failure.retryable, false);
    assert.match(failure.action, /before retrying/i);
});

test("formatProviderFailure redacts secrets in the provider message", () => {
    const failure = classifyProviderFailure(
        new Error("Unauthorized with key sk-or-v1-abcdefghijklmnop"),
    );
    const text = formatProviderFailure(failure);
    assert.ok(!text.includes("sk-or-v1-abcdefghijklmnop"));
    assert.match(text, /\[REDACTED\]/);
    assert.match(text, /authentication error/);
});
