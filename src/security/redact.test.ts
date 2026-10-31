import { test } from "node:test";
import assert from "node:assert/strict";
import { redactError, redactForDiagnostics, redactSecrets, secretValues } from "./redact.js";

const ENV = {
    OPENROUTER_API_KEY: "sk-or-v1-abcdefghijklmnop",
    ANTHROPIC_API_KEY: "sk-ant-api03-zyxwvutsrqponml",
    SAFE_VALUE: "not-a-secret",
} as NodeJS.ProcessEnv;

test("secretValues only collects secret-looking environment names", () => {
    const values = secretValues(ENV);
    assert.ok(values.includes("sk-or-v1-abcdefghijklmnop"));
    assert.ok(values.includes("sk-ant-api03-zyxwvutsrqponml"));
    assert.ok(!values.includes("not-a-secret"));
});

test("redactSecrets removes literal environment secret values", () => {
    const text = "request failed with key sk-or-v1-abcdefghijklmnop during setup";
    const redacted = redactSecrets(text, ENV);
    assert.ok(!redacted.includes("sk-or-v1-abcdefghijklmnop"));
    assert.match(redacted, /\[REDACTED\]/);
});

test("redactSecrets removes API key patterns that are not in the environment", () => {
    const text = "Unauthorized: sk-or-v1-0000000000000000 and sk-ant-api03-1111111111111111";
    const redacted = redactSecrets(text, {});
    assert.ok(!redacted.includes("0000000000000000"));
    assert.ok(!redacted.includes("1111111111111111"));
});

test("redactSecrets preserves the field name while removing the value", () => {
    const text = '{"api_key":"super-secret-value","model":"x"}';
    const redacted = redactSecrets(text, {});
    assert.match(redacted, /api_key/);
    assert.ok(!redacted.includes("super-secret-value"));
});

test("redactSecrets removes bearer tokens", () => {
    const redacted = redactSecrets("Authorization: Bearer abcdefghijklmnop1234", {});
    assert.ok(!redacted.includes("abcdefghijklmnop1234"));
});

test("redactForDiagnostics strips nested secret fields and values", () => {
    const text = redactForDiagnostics({
        headers: { authorization: "Bearer abcdefghijklmnop", "x-api-key": "sk-or-v1-abcdefghijklmnop" },
        nested: { password: "hunter2hunter2" },
        note: "key sk-or-v1-abcdefghijklmnop leaked",
    });
    assert.ok(!text.includes("abcdefghijklmnop"));
    assert.ok(!text.includes("hunter2hunter2"));
    assert.match(text, /\[REDACTED\]/);
    assert.match(text, /authorization/);
});

test("redactForDiagnostics survives circular structures", () => {
    const value: Record<string, unknown> = { name: "x" };
    value.self = value;
    const text = redactForDiagnostics(value);
    assert.match(text, /Circular/);
});

test("redactError handles non-Error values", () => {
    assert.equal(redactError("failed with sk-or-v1-abcdefghijklmnop"), "failed with [REDACTED]");
    assert.equal(redactError(42), "42");
});

test("redactSecrets leaves harmless text untouched", () => {
    const text = "Build finished in 1200ms with 3 files changed.";
    assert.equal(redactSecrets(text, ENV), text);
});
