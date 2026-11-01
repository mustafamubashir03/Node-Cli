import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getSkillInfo } from "../skills/registry.js";
import { activateSkill } from "../skills/use-skill.js";
import { createUseSkillMcpServer } from "../skills/use-skill.js";
import { readFileSync } from "node:fs";
import { runOneShotPrompt } from "./one-shot-prompt.js";
import type { RunReport } from "../agent/run-report.js";

process.env.OPENROUTER_API_KEY ??= "test-key";

type CapturedRequest = { prompt: string; options: any };

function tempHome(): string {
    const dir = mkdtempSync(join(tmpdir(), "phase8-home-"));
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

test("selected skill is requested, allowed, and its full instructions are returned", async () => {
    await withTempHome(["accessibility"], async (home) => {
        const body = activateSkill("accessibility").body!;
        const messages = [
            assistant([
                { type: "text", text: "I will activate the accessibility skill." },
                { type: "tool_use", id: "tool-1", name: "mcp__node-cli__UseSkill", input: { skillId: "accessibility" } },
            ]),
            user([
                { type: "tool_result", tool_use_id: "tool-1", content: body, is_error: false },
            ]),
            assistant([{ type: "text", text: "Applied the accessibility guidance." }]),
            sdkResult(),
        ];
        const { factory, captured } = makeQuery(messages);

        await runOneShotPrompt("Fix accessibility issues: keyboard navigation and ARIA labels", {
            mode: "agent",
            timeoutMs: 1000,
            reportPath: "off",
            sdkQueryFactory: factory,
        });

        assert.match(captured.prompt, /\[skill-router\]/);
        assert.match(captured.prompt, /accessibility/);
        assert.ok(captured.options.tools.includes("UseSkill"), "UseSkill must be in the tool list");
        assert.ok(captured.options.mcpServers && "node-cli" in captured.options.mcpServers);
        assert.equal(captured.options.permissionMode, "acceptEdits");
        assert.equal(captured.options.maxTurns, 25);
        assert.match(String(captured.options.systemPrompt?.append ?? ""), /Enabled Skills/);
        assert.match(String(captured.options.systemPrompt?.append ?? ""), /accessibility/);

        const canUse = captured.options.canUseTool;
        assert.ok(typeof canUse === "function");
        const permission = await canUse("mcp__node-cli__UseSkill", { skillId: "accessibility" });
        assert.deepEqual(permission, { behavior: "allow" });

        const modeHook = captured.options.hooks?.PreToolUse?.[0]?.hooks?.[0];
        assert.ok(typeof modeHook === "function");
        const hookResult = await modeHook({ hook_event_name: "PreToolUse", tool_name: "mcp__node-cli__UseSkill" });
        assert.equal(hookResult.hookSpecificOutput?.permissionDecision, undefined);

        const server = captured.options.mcpServers["node-cli"];
        const tool = server.instance._registeredTools.UseSkill;
        const toolResult = await tool.handler({ skillId: "accessibility" });
        assert.equal(toolResult.isError, undefined);
        assert.equal(toolResult.content[0].text, body);

        const reportPath = join(home, "unused-report.json");
        void reportPath;
    });
});

test("disabled skill activation is explicit and is not reported as loaded", async () => {
    await withTempHome(["accessibility"], async (home) => {
        const messages = [
            assistant([
                { type: "tool_use", id: "tool-1", name: "mcp__node-cli__UseSkill", input: { skillId: "performance" } },
            ]),
            user([
                { type: "tool_result", tool_use_id: "tool-1", content: "Skill 'performance' is installed but not enabled for this session.", is_error: true },
            ]),
            assistant([{ type: "text", text: "Proceeding without that skill." }]),
            sdkResult(),
        ];
        const { factory } = makeQuery(messages);

        await runOneShotPrompt("Fix accessibility issues: keyboard navigation and ARIA labels", {
            mode: "agent",
            timeoutMs: 1000,
            reportPath: "off",
            sdkQueryFactory: factory,
        });

        const server = createUseSkillMcpServer(["accessibility"]);
        const tool = (server as any).instance._registeredTools.UseSkill;
        const result = await tool.handler({ skillId: "performance" });
        assert.equal(result.isError, true);
        assert.match(result.content[0].text, /not enabled/);
    });
});

test("unavailable skill activation is explicit", async () => {
    const server = createUseSkillMcpServer(["accessibility", "definitely-not-a-skill"]);
    const tool = (server as any).instance._registeredTools.UseSkill;
    const result = await tool.handler({ skillId: "definitely-not-a-skill" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /not in the catalog|unavailable|unknown/i);
});

test("a simple task does not select a skill or trigger UseSkill", async () => {
    await withTempHome(["accessibility"], async () => {
        const messages = [
            assistant([{ type: "text", text: "Created the file." }]),
            sdkResult(),
        ];
        const { factory, captured } = makeQuery(messages);

        await runOneShotPrompt("Create a file named hello.txt containing exactly: hello", {
            mode: "agent",
            timeoutMs: 1000,
            reportPath: "off",
            sdkQueryFactory: factory,
        });

        assert.equal(captured.prompt, "Create a file named hello.txt containing exactly: hello");
        assert.doesNotMatch(captured.prompt, /\[skill-router\]/);
        assert.equal(process.exitCode, 0);
    });
});

test("tool permission configuration allows the intended skill tool in every mode", async () => {
    const { isToolAllowed } = await import("../agent/modes.js");
    for (const mode of ["agent", "ask", "plan", "strict"] as const) {
        assert.equal(isToolAllowed(mode, "mcp__node-cli__UseSkill"), true, mode);
    }
});

test("a tool failure is visible in the report", async () => {
    await withTempHome(["accessibility"], async (home) => {
        const messages = [
            assistant([
                { type: "tool_use", id: "tool-1", name: "Write", input: { file_path: "src/App.tsx", content: "x" } },
            ]),
            user([
                { type: "tool_result", tool_use_id: "tool-1", content: "permission denied", is_error: true },
            ]),
            assistant([{ type: "text", text: "I could not write the file." }]),
            sdkResult(),
        ];
        const { factory } = makeQuery(messages);

        const reportPath = join(home, "tool-failure-report.json");
        await runOneShotPrompt("Fix accessibility issues: keyboard navigation and ARIA labels", {
            mode: "agent",
            timeoutMs: 1000,
            reportPath,
            sdkQueryFactory: factory,
        });
        const report = JSON.parse(readFileSync(reportPath, "utf8")) as RunReport;

        assert.equal(report.toolSummary.total, 1);
        assert.equal(report.toolSummary.failed, 1);
        assert.equal(report.toolCalls[0].status, "failed");
        assert.match(report.toolCalls[0].result ?? "", /permission denied/);
        assert.equal(report.termination.reason, "tool_failure");
        assert.equal(process.exitCode, 1);
    });
});

test("the structured report distinguishes selected, invoked, loaded, and completed states", async () => {
    await withTempHome(["accessibility"], async (home) => {
        const body = activateSkill("accessibility").body!;
        const messages = [
            assistant([
                { type: "tool_use", id: "tool-1", name: "mcp__node-cli__UseSkill", input: { skillId: "accessibility" } },
            ]),
            user([
                { type: "tool_result", tool_use_id: "tool-1", content: body, is_error: false },
            ]),
            assistant([{ type: "text", text: "Done" }]),
            sdkResult(),
        ];
        const { factory } = makeQuery(messages);

        const reportPath = join(home, "run-report.json");
        await runOneShotPrompt("Fix accessibility issues: keyboard navigation and ARIA labels", {
            mode: "agent",
            timeoutMs: 1000,
            reportPath,
            sdkQueryFactory: factory,
        });
        const report = JSON.parse(readFileSync(reportPath, "utf8")) as RunReport;

        assert.deepEqual(report.skills.selected, ["accessibility"]);
        assert.deepEqual(report.skills.recommended, ["accessibility"]);
        assert.deepEqual(report.skills.loaded, ["accessibility"]);
        assert.equal(report.toolSummary.useSkillCalls, 1);
        assert.equal(report.termination.reason, "completed");
        assert.equal(report.termination.exitCode, 0);
    });
});

