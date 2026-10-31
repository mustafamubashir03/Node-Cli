import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
    RunReportBuilder,
    classifyTermination,
    defaultRunReportPath,
    formatRunReport,
    writeRunReport,
    type RunReportInit,
} from "./run-report.js";
import type { SkillSelection } from "../skills/selection.js";

type ResultMessage = Extract<SDKMessage, { type: "result" }>;

const selection: SkillSelection = {
    candidates: ["frontend-design", "accessibility"],
    enabled: ["frontend-design", "accessibility"],
    recommended: ["frontend-design"],
    selected: ["frontend-design"],
    scores: [{ id: "frontend-design", score: 12, reason: "triggers: design" }],
    budget: { used: 600, limit: 3000, over: false },
};

function init(overrides: Partial<RunReportInit> = {}): RunReportInit {
    return {
        mode: "agent",
        prompt: "Build a polished landing page",
        model: "test/model",
        selection,
        availableSkills: ["frontend-design", "accessibility"],
        tools: ["Read", "Write", "UseSkill"],
        permissionMode: "acceptEdits",
        maxTurns: 25,
        maxBudgetUsd: 1,
        mcpServers: ["node-cli"],
        cwd: "C:/work",
        selectionVersion: "router-v1",
        ...overrides,
    };
}

function toolUse(id: string, name: string, input: Record<string, unknown> = {}): SDKMessage {
    return {
        type: "assistant",
        message: { content: [{ type: "tool_use", id, name, input }] },
    } as unknown as SDKMessage;
}

function toolResult(id: string, content: string, isError = false): SDKMessage {
    return {
        type: "user",
        message: { content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
    } as unknown as SDKMessage;
}

function result(
    subtype: ResultMessage["subtype"],
    extra: Record<string, unknown> = {},
): ResultMessage {
    return {
        type: "result",
        subtype,
        duration_ms: 100,
        duration_api_ms: 90,
        is_error: subtype !== "success",
        num_turns: 2,
        stop_reason: null,
        total_cost_usd: 0.0123,
        usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5,
        },
        result: "Done",
        ...extra,
    } as unknown as ResultMessage;
}

function finish(builder: RunReportBuilder, overrides: Partial<Parameters<RunReportBuilder["finish"]>[0]> = {}) {
    return builder.finish({
        result: result("success"),
        timedOut: false,
        cancelled: false,
        error: null,
        ...overrides,
    });
}

test("reports recommended, selected, available, and loaded skills separately", () => {
    const builder = new RunReportBuilder(init(), "run-test");
    builder.observe(toolUse("t1", "mcp__node-cli__UseSkill", { skillId: "frontend-design" }));
    builder.observe(toolResult("t1", "Skill 'frontend-design' loaded."));
    builder.observe(toolUse("t2", "Read", { file_path: "src/App.tsx" }));
    builder.observe(toolResult("t2", "file contents"));

    const report = finish(builder);

    assert.deepEqual(report.skills.recommended, ["frontend-design"]);
    assert.deepEqual(report.skills.selected, ["frontend-design"]);
    assert.deepEqual(report.skills.available, ["frontend-design", "accessibility"]);
    assert.deepEqual(report.skills.loaded, ["frontend-design"]);
    assert.deepEqual(report.skills.requested, ["frontend-design"]);
    assert.deepEqual(report.skills.retrievalCounts, { "frontend-design": 1 });
    assert.equal(report.skills.repeatedRetrievals, 0);
    assert.deepEqual(report.skills.loadFailures, []);
    assert.equal(report.skills.selectionVersion, "router-v1");
    assert.ok(report.skills.selectedContextTokens > 0);
});

test("repeated skill retrieval is tracked separately", () => {
    const builder = new RunReportBuilder(init(), "run-repeat");
    builder.observe(toolUse("t1", "mcp__node-cli__UseSkill", { skillId: "frontend-design" }));
    builder.observe(toolResult("t1", "Skill 'frontend-design' loaded."));
    builder.observe(toolUse("t2", "mcp__node-cli__UseSkill", { skillId: "frontend-design" }));
    builder.observe(toolResult("t2", "Skill 'frontend-design' loaded."));

    const report = finish(builder);

    assert.deepEqual(report.skills.loaded, ["frontend-design"]);
    assert.deepEqual(report.skills.requested, ["frontend-design"]);
    assert.deepEqual(report.skills.retrievalCounts, { "frontend-design": 2 });
    assert.equal(report.skills.repeatedRetrievals, 1);
});

test("failed skill retrieval is tracked as a load failure, not a load", () => {
    const builder = new RunReportBuilder(init(), "run-fail-skill");
    builder.observe(toolUse("t1", "mcp__node-cli__UseSkill", { skillId: "accessibility" }));
    builder.observe(toolResult("t1", "Skill is not enabled.", true));

    const report = finish(builder);

    assert.deepEqual(report.skills.loaded, []);
    assert.deepEqual(report.skills.requested, ["accessibility"]);
    assert.deepEqual(report.skills.retrievalCounts, { accessibility: 1 });
    assert.equal(report.skills.repeatedRetrievals, 0);
    assert.equal(report.skills.loadFailures.length, 1);
});

test("router-selected but not model-requested skills are distinguishable", () => {
    const builder = new RunReportBuilder(init(), "run-not-requested");
    // No UseSkill calls — model never requested the selected skill
    builder.observe(toolUse("t1", "Read", { file_path: "src/App.tsx" }));
    builder.observe(toolResult("t1", "file contents"));

    const report = finish(builder);

    assert.deepEqual(report.skills.selected, ["frontend-design"]);
    assert.deepEqual(report.skills.requested, []);
    assert.deepEqual(report.skills.loaded, []);
    assert.deepEqual(report.skills.retrievalCounts, {});
    assert.equal(report.skills.repeatedRetrievals, 0);
});

test("a failed UseSkill call is recorded as a load failure, not a load", () => {
    const builder = new RunReportBuilder(init(), "run-failure");
    builder.observe(toolUse("t1", "UseSkill", { skillId: "accessibility" }));
    builder.observe(toolResult("t1", "Skill is not enabled.", true));

    const report = finish(builder);

    assert.deepEqual(report.skills.loaded, []);
    assert.equal(report.skills.loadFailures.length, 1);
    assert.equal(report.skills.loadFailures[0].skillId, "accessibility");
    assert.match(report.skills.loadFailures[0].message, /not enabled/);
});

test("tool summary counts total, statuses, ImageSearch, and UseSkill", () => {
    const builder = new RunReportBuilder(init(), "run-tools");
    builder.observe(toolUse("t1", "mcp__node-cli-images__ImageSearch", { query: "food" }));
    builder.observe(toolResult("t1", "no providers", true));
    builder.observe(toolUse("t2", "UseSkill", { skillId: "frontend-design" }));
    builder.observe(toolResult("t2", "loaded"));
    builder.observe(toolUse("t3", "Write", { file_path: "src/App.tsx" }));

    const summary = builder.getToolSummary();
    assert.deepEqual(summary, {
        total: 3,
        succeeded: 1,
        failed: 1,
        pending: 1,
        imageSearchCalls: 1,
        useSkillCalls: 1,
    });
});

test("usage and cost come from the SDK result", () => {
    const builder = new RunReportBuilder(init(), "run-usage");
    const report = finish(builder);
    assert.equal(report.usage.inputTokens, 100);
    assert.equal(report.usage.outputTokens, 50);
    assert.equal(report.usage.cacheReadTokens, 10);
    assert.equal(report.usage.cacheCreationTokens, 5);
    assert.equal(report.usage.turns, 2);
    assert.equal(report.usage.costUsd, 0.0123);
});

test("a successful result classifies as completed", () => {
    const builder = new RunReportBuilder(init(), "run-completed");
    const report = finish(builder);
    assert.equal(report.termination.reason, "completed");
    assert.equal(report.termination.exitCode, 0);
});

test("timeout wins over any partial result", () => {
    const builder = new RunReportBuilder(init(), "run-timeout");
    const report = finish(builder, { result: null, timedOut: true });
    assert.equal(report.termination.reason, "timeout");
    assert.equal(report.termination.exitCode, 1);
});

test("cancellation wins over timeout", () => {
    const builder = new RunReportBuilder(init(), "run-cancel");
    const report = finish(builder, { result: null, cancelled: true, timedOut: true });
    assert.equal(report.termination.reason, "cancelled");
});

test("turn and budget limits have explicit reasons", () => {
    const turns = finish(new RunReportBuilder(init(), "run-turns"), {
        result: result("error_max_turns"),
    });
    assert.equal(turns.termination.reason, "turn_limit");

    const budget = finish(new RunReportBuilder(init(), "run-budget"), {
        result: result("error_max_budget_usd"),
    });
    assert.equal(budget.termination.reason, "budget_limit");
});

test("an execution error is classified as a provider error", () => {
    const builder = new RunReportBuilder(init(), "run-provider");
    const report = finish(builder, {
        result: result("error_during_execution", { result: "401 unauthorized: invalid api key" }),
    });
    assert.equal(report.termination.reason, "provider_error");
});

test("a missing result without an error is incomplete", () => {
    const builder = new RunReportBuilder(init(), "run-incomplete");
    const report = finish(builder, { result: null });
    assert.equal(report.termination.reason, "incomplete");
});

test("a run where every observed tool call failed reports tool_failure", () => {
    const builder = new RunReportBuilder(init(), "run-tool-failure");
    builder.observe(toolUse("t1", "Write", { file_path: "src/App.tsx" }));
    builder.observe(toolResult("t1", "permission denied", true));
    const report = finish(builder);
    assert.equal(report.termination.reason, "tool_failure");
});

test("classifyTermination maps a budget-shaped thrown error", () => {
    const termination = classifyTermination({
        result: null,
        timedOut: false,
        cancelled: false,
        error: new Error("maximum budget exceeded"),
    });
    assert.equal(termination.reason, "budget_limit");
});

test("prompt previews and error details are redacted", () => {
    const prompt = "Use key sk-or-v1-abcdefghijklmnopqrstuvwxyz to finish";
    const builder = new RunReportBuilder(init({ prompt }), "run-redact");
    const report = finish(builder, {
        result: null,
        error: new Error("failed with sk-or-v1-abcdefghijklmnopqrstuvwxyz"),
    });

    assert.ok(!report.prompt.preview.includes("sk-or-v1-abcdefghijklmnopqrstuvwxyz"));
    assert.match(report.prompt.preview, /\[REDACTED\]/);
    assert.ok(!report.termination.detail.includes("sk-or-v1-abcdefghijklmnopqrstuvwxyz"));
});

test("writeRunReport writes both JSON and Markdown", () => {
    const dir = mkdtempSync(join(tmpdir(), "run-report-"));
    try {
        const builder = new RunReportBuilder(init(), "run-write");
        builder.observe(toolUse("t1", "UseSkill", { skillId: "frontend-design" }));
        builder.observe(toolResult("t1", "loaded"));
        const report = finish(builder);

        const target = join(dir, "nested", "run.json");
        const written = writeRunReport(report, target);

        const parsed = JSON.parse(readFileSync(written.jsonPath, "utf8"));
        assert.equal(parsed.schemaVersion, 1);
        assert.deepEqual(parsed.skills.loaded, ["frontend-design"]);

        const markdown = readFileSync(written.markdownPath, "utf8");
        assert.match(markdown, /Loaded by agent: frontend-design/);
        assert.match(markdown, /Termination: \*\*completed\*\*/);
        assert.equal(markdown, formatRunReport(report));
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("defaultRunReportPath uses NODE_CLI_HOME when set", () => {
    const previous = process.env.NODE_CLI_HOME;
    process.env.NODE_CLI_HOME = "C:/temp/node-cli-home";
    try {
        assert.equal(
            defaultRunReportPath("run-1"),
            join("C:/temp/node-cli-home", "runs", "run-1.json"),
        );
    } finally {
        if (previous === undefined) delete process.env.NODE_CLI_HOME;
        else process.env.NODE_CLI_HOME = previous;
    }
});

test("diagnostics capture retries and timeout classification", () => {
    const builder = new RunReportBuilder(init(), "run-diag");
    builder.recordRetry({ attempt: 1, maxRetries: 3, retryDelayMs: 1000, errorStatus: 429 });
    builder.recordHeartbeat();
    builder.recordInterruptionBegin();
    builder.setTimeoutClassification("deadline", "deadline exceeded");
    const report = finish(builder, { result: null, timedOut: true });
    assert.ok(report.diagnostics);
    assert.equal(report.diagnostics?.retries.length, 1);
    assert.equal(report.diagnostics?.retries[0].attempt, 1);
    assert.equal(report.diagnostics?.retries[0].errorStatus, 429);
    assert.equal(report.diagnostics?.timeoutClassification.kind, "deadline");
    assert.ok(report.diagnostics?.lastEvent);
    assert.ok(report.diagnostics?.interruption.beganAtMs);
});
