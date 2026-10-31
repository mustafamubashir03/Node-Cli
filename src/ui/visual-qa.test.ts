import { test } from "node:test";
import assert from "node:assert/strict";
import { isPlaywrightAvailable, runVisualQA } from "./visual-qa.js";

test("Playwright availability is checked without CommonJS require", async () => {
    const available = await isPlaywrightAvailable();
    assert.equal(typeof available, "boolean");
});

test("visual QA readiness is honest about missing tooling", async () => {
    const result = await runVisualQA();
    assert.equal(typeof result.ready, "boolean");
    assert.equal(result.ready, result.issues.length === 0);

    if (!result.checks.playwrightAvailable) {
        assert.equal(result.ready, false);
        assert.match(result.issues.join("\n"), /Playwright is not installed/);
    }
});

test("a readiness check does not claim a visual pass", async () => {
    const result = await runVisualQA();
    assert.ok(!("passed" in result), "readiness must not be reported as a quality verdict");
});
