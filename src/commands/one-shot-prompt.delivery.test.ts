import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOneShotPrompt } from "./one-shot-prompt.js";

process.env.OPENROUTER_API_KEY ??= "test-key";

function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "phase16-home-"));
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    return dir;
}

function sdkResult(): any {
    return {
        type: "result",
        subtype: "success",
        duration_ms: 5,
        duration_api_ms: 4,
        is_error: false,
        num_turns: 1,
        stop_reason: null,
        total_cost_usd: 0.001,
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        result: "Done",
    };
}

function makeQuery(messages: any[]): { factory: any; captured: { prompt: string } } {
    const captured: { prompt: string } = { prompt: "" };
    const factory = (request: any) => {
        captured.prompt = request.prompt;
        const iterator = (async function* () {
            for (const message of messages) yield message;
        })();
        return { [Symbol.asyncIterator]: () => iterator, interrupt: async () => undefined, return: async () => undefined };
    };
    return { factory, captured };
}

test("backend-only task does not receive frontend reference content", async () => {
    const home = tempHome();
    writeFileSync(join(home, ".node-cli.json"), JSON.stringify({ skills: [] }));
    const messages = [{ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }, sdkResult()];
    const { factory, captured } = makeQuery(messages);
    await runOneShotPrompt("Build a REST API endpoint for user authentication with postgres", {
        mode: "agent",
        timeoutMs: 1000,
        reportPath: "off",
        sdkQueryFactory: factory,
    });
    assert.doesNotMatch(captured.prompt, /Resolved frontend references/);
    rmSync(home, { recursive: true, force: true });
});

test("frontend task includes compact design plan in prompt", async () => {
    const home = tempHome();
    writeFileSync(join(home, ".node-cli.json"), JSON.stringify({ skills: [] }));
    const messages = [{ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }, sdkResult()];
    const { factory, captured } = makeQuery(messages);
    await runOneShotPrompt("Build a polished responsive React landing page", {
        mode: "agent",
        timeoutMs: 1000,
        reportPath: "off",
        sdkQueryFactory: factory,
    });
    assert.match(captured.prompt, /Frontend design plan \(compact, required before code\)/);
    rmSync(home, { recursive: true, force: true });
});

test("backend task does not include frontend design plan", async () => {
    const home = tempHome();
    writeFileSync(join(home, ".node-cli.json"), JSON.stringify({ skills: [] }));
    const messages = [{ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }, sdkResult()];
    const { factory, captured } = makeQuery(messages);
    await runOneShotPrompt("Build a REST API endpoint for user authentication with postgres", {
        mode: "agent",
        timeoutMs: 1000,
        reportPath: "off",
        sdkQueryFactory: factory,
    });
    assert.doesNotMatch(captured.prompt, /Frontend design plan/);
    rmSync(home, { recursive: true, force: true });
});

test("frontend design plan can be disabled via test seam (baseline)", async () => {
    const home = tempHome();
    writeFileSync(join(home, ".node-cli.json"), JSON.stringify({ skills: [] }));
    const messages = [{ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }, sdkResult()];
    const { factory, captured } = makeQuery(messages);
    await runOneShotPrompt("Build a polished responsive React landing page", {
        mode: "agent",
        timeoutMs: 1000,
        reportPath: "off",
        frontendDesignPlan: false,
        sdkQueryFactory: factory,
    });
    assert.doesNotMatch(captured.prompt, /Frontend design plan/);
    rmSync(home, { recursive: true, force: true });
});

test("resourceResolution is reported in the run report", async () => {
    const home = tempHome();
    writeFileSync(join(home, ".node-cli.json"), JSON.stringify({ skills: [] }));
    const messages = [{ type: "assistant", message: { content: [{ type: "text", text: "Done" }] } }, sdkResult()];
    const { factory } = makeQuery(messages);
    const reportPath = join(home, "r.json");
    await runOneShotPrompt("Build a REST API endpoint for user authentication with postgres", {
        mode: "agent",
        timeoutMs: 1000,
        reportPath,
        sdkQueryFactory: factory,
    });
    const { readFileSync } = await import("node:fs");
    const report = JSON.parse(readFileSync(reportPath, "utf8"));
    assert.ok(Array.isArray(report.resourceResolution));
    rmSync(home, { recursive: true, force: true });
});
