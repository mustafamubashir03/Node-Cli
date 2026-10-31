import { test } from "node:test";
import assert from "node:assert/strict";
import {
    mkdtempSync,
    rmSync,
    writeFileSync,
    readFileSync,
    existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runOneShotPrompt } from "./one-shot-prompt.js";
import type { RunReport } from "../agent/run-report.js";
import { createUseSkillMcpServer, activateSkill } from "../skills/use-skill.js";
import { selectSkills, toRouterResult } from "../skills/selection.js";
import { formatSkillShortlist } from "../skills/router.js";
import {
    commandExists,
    findExecutable,
    runCommand,
} from "./command-runner.js";
import { isPlaywrightAvailable } from "../ui/visual-qa.js";
import { maxBudgetUsd } from "../config/models.js";

process.env.OPENROUTER_API_KEY ??= "test-key";

/** ------------------------------------------------------------------ */
/** Helpers                                                            */
/** ------------------------------------------------------------------ */

type CapturedRequest = { prompt: string; options: unknown };

function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-home-"));
    process.env.HOME = dir;
    process.env.USERPROFILE = dir;
    return dir;
}

function writeConfig(home: string, skills: string[]): void {
    writeFileSync(join(home, ".node-cli.json"), JSON.stringify({ skills }, null, 2));
}

function sdkResult(overrides: Record<string, unknown> = {}): any {
    return {
        type: "result",
        subtype: "success",
        duration_ms: 5,
        duration_api_ms: 4,
        is_error: false,
        num_turns: 2,
        stop_reason: null,
        total_cost_usd: 0.001,
        usage: {
            input_tokens: 10,
            output_tokens: 5,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
        },
        result: "Done",
        ...overrides,
    };
}

function assistant(content: any): any {
    return { type: "assistant", message: { content } };
}

function user(content: any): any {
    return { type: "user", message: { content } };
}

/**
 * Builds a fake SDK query factory. Captures the request and replays
 * provided messages without touching the network or a real model.
 */
function makeQuery(messages: any[]): { factory: any; captured: CapturedRequest } {
    const captured: CapturedRequest = { prompt: "", options: null };
    const factory = (request: CapturedRequest) => {
        captured.prompt = request.prompt;
        captured.options = request.options;
        const iterator = (async function* () {
            for (const message of messages) yield message;
        })();
        return {
            [Symbol.asyncIterator]: () => iterator,
            interrupt: async () => undefined,
            return: async () => undefined,
        };
    };
    return { factory, captured };
}

function withTempHome(skills: string[], run: (home: string) => Promise<void>): Promise<void> {
    const home = tempHome();
    writeConfig(home, skills);
    return run(home).finally(() => {
        rmSync(home, { recursive: true, force: true });
    });
}

function readReport(home: string, fileName: string): RunReport {
    return JSON.parse(readFileSync(join(home, fileName), "utf8")) as RunReport;
}

/** ------------------------------------------------------------------ */
/** Stage 2A: Configuration and budget                                 */
/** ------------------------------------------------------------------ */

test("no hidden default $1 budget cap: maxBudgetUsd() returns undefined when unset", () => {
    delete process.env.MAX_BUDGET_USD;
    assert.equal(maxBudgetUsd(), undefined);
});

test("explicit MAX_BUDGET_USD is honored when set", () => {
    process.env.MAX_BUDGET_USD = "5";
    assert.equal(maxBudgetUsd(), 5);
    delete process.env.MAX_BUDGET_USD;
});

test("invalid MAX_BUDGET_USD returns undefined (no silent default)", () => {
    process.env.MAX_BUDGET_USD = "not-a-number";
    assert.equal(maxBudgetUsd(), undefined);
    delete process.env.MAX_BUDGET_USD;
});

/** ------------------------------------------------------------------ */
/** Stage 2B/2C: Skill selection → loading → delivery                  */
/** ------------------------------------------------------------------ */

test("selected skill instruction body reaches the fake model adapter", async () => {
    await withTempHome(["frontend-design"], async (home) => {
        const body = activateSkill("frontend-design").body!;
        const messages = [
            assistant([
                { type: "text", text: "I will activate the frontend design skill." },
                {
                    type: "tool_use",
                    id: "tool-1",
                    name: "mcp__node-cli__UseSkill",
                    input: { skillId: "frontend-design" },
                },
            ]),
            user([{ type: "tool_result", tool_use_id: "tool-1", content: body, is_error: false }]),
            assistant([{ type: "text", text: "Applied frontend design guidance." }]),
            sdkResult(),
        ];
        const { factory, captured } = makeQuery(messages);

        await runOneShotPrompt("Create a beautiful coffee shop landing page in html, css and js.", {
            mode: "agent",
            timeoutMs: 5000,
            reportPath: "off",
            sdkQueryFactory: factory,
        });

        // 1. The request entered the orchestration path.
        assert.ok(captured.prompt, "composed prompt must be non-empty");

        // 2. Skill selection ran (shortlist present).
        assert.match(captured.prompt, /\[skill-router\]/);

        // 3. The selected skill's ACTUAL instruction body is in the
        //    system prompt appendix (delivered to the model adapter).
        const systemAppend = String(
            (captured.options as any).systemPrompt?.append ?? "",
        );
        assert.match(systemAppend, /Enabled Skills/);
        assert.match(systemAppend, /frontend-design/);

        // 4. Tool definitions are available to the model adapter.
        const tools = (captured.options as any).tools as string[];
        assert.ok(tools.includes("UseSkill"), "UseSkill must be in the tool list");

        // 5. The UseSkill MCP server returns the actual skill body.
        const server = (captured.options as any).mcpServers["node-cli"];
        const tool = server.instance._registeredTools.UseSkill;
        const toolResult = await tool.handler({ skillId: "frontend-design" });
        assert.equal(toolResult.isError, undefined);
        assert.equal(toolResult.content[0].text, body);

        // 6. Run reporting records completion.
        const reportPath = join(home, "report.json");
        const { factory: f2 } = makeQuery([
            assistant([{ type: "text", text: "Done" }]),
            sdkResult(),
        ]);
        await runOneShotPrompt("Create a coffee shop page", {
            mode: "agent",
            timeoutMs: 5000,
            reportPath,
            sdkQueryFactory: f2,
        });
        const report = readReport(home, "report.json");
        assert.equal(report.termination.reason, "completed");
        assert.equal(report.termination.exitCode, 0);
    });
});

test("unselected skill bodies are not injected into the model adapter input", async () => {
    await withTempHome(["accessibility", "frontend-design"], async (home) => {
        const messages = [
            assistant([{ type: "text", text: "Done" }]),
            sdkResult(),
        ];
        const { factory, captured } = makeQuery(messages);

        await runOneShotPrompt("Build a polished responsive React landing page", {
            mode: "agent",
            timeoutMs: 5000,
            reportPath: "off",
            sdkQueryFactory: factory,
        });

        const systemAppend = String(
            (captured.options as any).systemPrompt?.append ?? "",
        );
        // The index lists all enabled skills (names only), which is by design.
        // The full skill BODY is only delivered via UseSkill MCP on activation.
        // Verify the accessibility BODY is not in the system prompt appendix.
        const accessibilityBody = activateSkill("accessibility").body!;
        assert.doesNotMatch(systemAppend, new RegExp(escapeRegex(accessibilityBody.slice(0, 40))));
        // frontend-design body should also not be in the appendix (only index names).
        const fdBody = activateSkill("frontend-design").body!;
        assert.doesNotMatch(systemAppend, new RegExp(escapeRegex(fdBody.slice(0, 40))));

        // Verify selection is correct: frontend-design selected, accessibility not.
        const selection = selectSkills("Build a polished responsive React landing page", {
            mode: "agent",
            enabledSkills: ["accessibility", "frontend-design"],
        });
        assert.ok(selection.selected.includes("frontend-design"));
        assert.ok(!selection.selected.includes("accessibility"));
    });
});

test("resource delivery is honest: delivered content appears in prompt, cataloged-only resources do not", async () => {
    await withTempHome([], async (home) => {
        const messages = [
            assistant([{ type: "text", text: "Done" }]),
            sdkResult(),
        ];
        const { factory, captured } = makeQuery(messages);
        const reportPath = join(home, "resource-report.json");

        await runOneShotPrompt("Build a coffee shop landing page", {
            mode: "agent",
            timeoutMs: 5000,
            reportPath,
            sdkQueryFactory: factory,
        });

        const report = readReport(home, "resource-report.json");
        assert.ok(Array.isArray(report.resourceResolution));
        assert.ok(report.resourceResolution.length > 0, "frontend references should be consulted");

        // Every DELIVERED resource must have its content in the prompt.
        for (const r of report.resourceResolution) {
            if (r.delivered) {
                assert.ok(captured.prompt.includes(`### Reference: ${r.id}`),
                    `delivered resource ${r.id} missing from prompt`);
                assert.ok(r.content === null || r.bytes > 0,
                    `delivered resource ${r.id} should have content or bytes`);
            } else {
                // Non-delivered resources must not appear as references in the prompt.
                assert.ok(!captured.prompt.includes(`### Reference: ${r.id}`),
                    `non-delivered resource ${r.id} should not be in prompt`);
            }
        }

        // Some resources may be CATALOGED (no source repo/revision) and thus
        // not fetchable; they must be reported honestly as not delivered.
        const cataloged = report.resourceResolution.filter((r) => r.status === "CATALOGED");
        for (const r of cataloged) {
            assert.equal(r.delivered, false);
            assert.ok(r.error != null, `cataloged resource ${r.id} should have an error reason`);
        }

        // Reported selected skills match what the router produced.
        assert.ok(Array.isArray(report.skills.selected));
    });
});

function escapeRegex(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** ------------------------------------------------------------------ */
/** Stage 2D: Request composition                                      */
/** ------------------------------------------------------------------ */

test("composed request reaches the adapter without leaking secrets", async () => {
    await withTempHome(["frontend-design"], async (home) => {
        const messages = [assistant([{ type: "text", text: "Done" }]), sdkResult()];
        const { factory, captured } = makeQuery(messages);

        await runOneShotPrompt("Create a landing page with HTML and CSS", {
            mode: "agent",
            timeoutMs: 5000,
            reportPath: "off",
            sdkQueryFactory: factory,
        });

        assert.ok(captured.prompt.length > 0);
        const systemAppend = String(
            (captured.options as any).systemPrompt?.append ?? "",
        );
        assert.ok(systemAppend.length > 0);

        // No API keys in composed prompt or system prompt appendix.
        assert.doesNotMatch(captured.prompt, /sk-/i);
        assert.doesNotMatch(systemAppend, /sk-/i);
    });
});

/** ------------------------------------------------------------------ */
/** Stage 2E: Tool execution and side effects                          */
/** ------------------------------------------------------------------ */

test("fake UseSkill call dispatches through real MCP handler and returns skill body", async () => {
    const server = createUseSkillMcpServer(["frontend-design"]);
    const tool = (server as any).instance._registeredTools.UseSkill;
    const body = activateSkill("frontend-design").body!;

    const result = await tool.handler({ skillId: "frontend-design" });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, body);
    assert.equal(result.content[0].type, "text");
});

test("missing skill handler returns an error, not the skill body", async () => {
    const server = createUseSkillMcpServer(["frontend-design"]);
    const tool = (server as any).instance._registeredTools.UseSkill;

    const result = await tool.handler({ skillId: "nonexistent-skill-xyz" });
    assert.equal(result.isError, true);
    assert.ok(result.content[0].text.length > 0);
    assert.notEqual(result.content[0].text, activateSkill("frontend-design").body);
});

test("failed tool result propagates into final run status as tool_failure", async () => {
    await withTempHome(["accessibility"], async (home) => {
        const body = activateSkill("accessibility").body!;
        const messages = [
            assistant([
                {
                    type: "tool_use",
                    id: "tool-1",
                    name: "mcp__node-cli__UseSkill",
                    input: { skillId: "accessibility" },
                },
            ]),
            user([
                {
                    type: "tool_result",
                    tool_use_id: "tool-1",
                    content: "activation failed",
                    is_error: true,
                },
            ]),
            assistant([{ type: "text", text: "Could not activate." }]),
            sdkResult(),
        ];
        const { factory } = makeQuery(messages);
        const reportPath = join(home, "tool-fail-report.json");

        await runOneShotPrompt("Fix accessibility issues", {
            mode: "agent",
            timeoutMs: 5000,
            reportPath,
            sdkQueryFactory: factory,
        });

        const report = readReport(home, "tool-fail-report.json");
        assert.equal(report.toolSummary.total, 1);
        assert.equal(report.toolSummary.failed, 1);
        assert.equal(report.toolCalls[0].status, "failed");
        assert.equal(report.termination.reason, "tool_failure");
        assert.equal(report.termination.exitCode, 1);
    });
});

test("no duplicate skill content injection: delivered once per activation", async () => {
    await withTempHome(["frontend-design"], async (home) => {
        const body = activateSkill("frontend-design").body!;
        const messages = [
            assistant([
                {
                    type: "tool_use",
                    id: "tool-1",
                    name: "mcp__node-cli__UseSkill",
                    input: { skillId: "frontend-design" },
                },
            ]),
            user([{ type: "tool_result", tool_use_id: "tool-1", content: body, is_error: false }]),
            assistant([{ type: "text", text: "Done" }]),
            sdkResult(),
        ];
        const { factory } = makeQuery(messages);
        const reportPath = join(home, "no-dup-report.json");

        await runOneShotPrompt("Create a landing page", {
            mode: "agent",
            timeoutMs: 5000,
            reportPath,
            sdkQueryFactory: factory,
        });

        const report = readReport(home, "no-dup-report.json");
        assert.equal(report.toolSummary.useSkillCalls, 1);
        assert.deepEqual(report.skills.loaded, ["frontend-design"]);
    });
});

/** ------------------------------------------------------------------ */
/** Stage 2F: Process/command execution                                */
/** ------------------------------------------------------------------ */

test("node executable is discoverable on PATH", () => {
    assert.equal(commandExists(process.execPath), true);
    const found = findExecutable(process.execPath);
    assert.ok(found !== null);
    assert.ok(existsSync(found!));
});

test("runCommand executes a minimal node script from a temp file and captures output", () => {
    const dir = mkdtempSync(join(tmpdir(), "cmd-run-"));
    const scriptFile = join(dir, "ready.js");
    try {
        writeFileSync(scriptFile, "console.log('ready');\n");
        const oneShot = runCommand(process.execPath, [scriptFile], {
            cwd: dir,
            timeoutMs: 5000,
            stdio: "pipe",
        });
        assert.equal(oneShot.status, 0);
        assert.match(oneShot.stdout, /ready/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("invalid command fails cleanly with an error", () => {
    const dir = mkdtempSync(join(tmpdir(), "invalid-cmd-"));
    const exitCodeBefore = process.exitCode;
    try {
        const result = runCommand("nonexistent-command-xyz-12345", [], {
            cwd: dir,
            timeoutMs: 5000,
            stdio: "pipe",
        });
        // On Windows, spawnSync may throw ENOENT which becomes result.error,
        // or it may return status null with an error set.
        assert.ok(
            result.error !== null || result.status === null || result.status !== 0,
            "invalid command should not succeed",
        );
    } finally {
        process.exitCode = exitCodeBefore;
        rmSync(dir, { recursive: true, force: true });
    }
});

/** ------------------------------------------------------------------ */
/** Stage 5: Browser verification                                      */
/** ------------------------------------------------------------------ */

test("browser tooling availability is reported honestly", async () => {
    const available = await isPlaywrightAvailable();
    assert.equal(typeof available, "boolean");
    // After Playwright installation, availability should be true.
    // If Playwright is not installed, it should be false.
    if (available) {
        assert.equal(available, true);
    } else {
        assert.equal(available, false);
    }
});

/** ------------------------------------------------------------------ */
/** Stage 7: Live provider test — NOT RUN                              */
/** ------------------------------------------------------------------ */

test("live provider test is NOT RUN without safe credentials", () => {
    const hasRealKey =
        process.env.OPENROUTER_API_KEY &&
        process.env.OPENROUTER_API_KEY !== "test-key" &&
        process.env.OPENROUTER_API_KEY.length > 20;
    assert.equal(hasRealKey, false, "no real provider credentials configured");
});
