import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { TurnMonitor } from "./turn-monitor.js";

function toolUse(id: string, name: string, input: Record<string, unknown>): SDKMessage {
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

function result(subtype: "success" | "error_during_execution"): SDKMessage {
    return { type: "result", subtype } as unknown as SDKMessage;
}

test("a successful write to an existing non-empty file is not flagged", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-cli-monitor-"));
    const file = join(dir, "index.html");
    writeFileSync(file, "<h1>ok</h1>");

    try {
        const monitor = new TurnMonitor();
        monitor.observe(toolUse("t1", "Write", { file_path: file }));
        monitor.observe(toolResult("t1", "File written"));
        monitor.observe(result("success"));

        const summary = monitor.summary();
        assert.equal(summary.successfulToolCalls, 1);
        assert.deepEqual(summary.writesMissing, []);
        assert.deepEqual(monitor.completionWarnings(), []);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("a claimed write with no file on disk is reported as unverified", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-cli-monitor-"));
    const file = join(dir, "missing.html");

    try {
        const monitor = new TurnMonitor();
        monitor.observe(toolUse("t1", "Write", { file_path: file }));
        monitor.observe(toolResult("t1", "File created successfully"));
        monitor.observe(result("success"));

        assert.deepEqual(monitor.summary().writesMissing, [file]);
        assert.match(monitor.completionWarnings().join("\n"), /did not leave a non-empty file/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("an empty file does not count as a verified write", () => {
    const dir = mkdtempSync(join(tmpdir(), "node-cli-monitor-"));
    const file = join(dir, "empty.css");
    writeFileSync(file, "");

    try {
        const monitor = new TurnMonitor();
        monitor.observe(toolUse("t1", "Write", { file_path: file }));
        monitor.observe(toolResult("t1", "ok"));
        assert.deepEqual(monitor.summary().writesMissing, [file]);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("a failed write is reported and not treated as an artifact", () => {
    const monitor = new TurnMonitor();
    monitor.observe(toolUse("t1", "Edit", { file_path: "C:\\project\\nope.css" }));
    monitor.observe(toolResult("t1", "String to replace not found", true));
    monitor.observe(result("success"));

    const summary = monitor.summary();
    assert.deepEqual(summary.writesFailed, ["C:\\project\\nope.css"]);
    assert.deepEqual(summary.writesMissing, []);
    assert.match(monitor.completionWarnings().join("\n"), /Write\/Edit failed/);
});

test("a replayed tool-use id is detected rather than re-executed", () => {
    const monitor = new TurnMonitor();
    monitor.observe(toolUse("t1", "Bash", { command: "echo hi" }));
    monitor.observe(toolResult("t1", "hi"));
    monitor.observe(toolUse("t1", "Bash", { command: "echo hi" }));
    monitor.observe(result("success"));

    assert.deepEqual(monitor.summary().duplicateToolUseIds, ["t1"]);
    assert.match(monitor.completionWarnings().join("\n"), /replayed tool-call ID/);
});

test("three identical consecutive failures stop the turn", () => {
    const monitor = new TurnMonitor();
    let stop = false;
    let reason: string | undefined;

    for (const id of ["t1", "t2", "t3"]) {
        monitor.observe(toolUse(id, "Bash", { command: "pnpm build" }));
        const update = monitor.observe(toolResult(id, "Command failed with exit code 1: missing script", true));
        stop = update.stop;
        reason = update.reason;
    }

    assert.equal(stop, true);
    assert.match(reason ?? "", /3 identical 'Bash' failures/);
    assert.match(reason ?? "", /did not make progress/);
});

test("repeated failures with different errors do not stop the turn", () => {
    const monitor = new TurnMonitor();
    const failures = ["missing script build", "permission denied", "file not found"];

    for (const [index, message] of failures.entries()) {
        const id = `t${index}`;
        monitor.observe(toolUse(id, "Bash", { command: `step-${index}` }));
        const update = monitor.observe(toolResult(id, message, true));
        assert.equal(update.stop, false);
    }
});

test("a success resets the identical-failure streak", () => {
    const monitor = new TurnMonitor();

    monitor.observe(toolUse("t1", "Bash", { command: "x" }));
    monitor.observe(toolResult("t1", "same error", true));
    monitor.observe(toolUse("t2", "Bash", { command: "x" }));
    monitor.observe(toolResult("t2", "same error", true));
    monitor.observe(toolUse("t3", "Bash", { command: "x" }));
    monitor.observe(toolResult("t3", "ok"));
    monitor.observe(toolUse("t4", "Bash", { command: "x" }));
    const update = monitor.observe(toolResult("t4", "same error", true));

    assert.equal(update.stop, false, "the streak must reset after a success");
});

test("an unsuccessful provider result stops the turn", () => {
    const monitor = new TurnMonitor();
    const update = monitor.observe(result("error_during_execution"));
    assert.equal(update.stop, true);
    assert.match(update.reason ?? "", /without success/);
});
test("repeated identical assistant narration stops the turn", () => {
    const monitor = new TurnMonitor();
    const msg = (text: string) => ({
        type: "assistant",
        message: { content: [{ type: "text", text }] },
    }) as unknown as SDKMessage;

    const text = "I understand the codebase and my plan is to improve the design by adjusting spacing and typography across the main stylesheet.";
    assert.equal(monitor.observe(msg(text)).stop, false);
    assert.equal(monitor.observe(msg(text)).stop, false);
    const update = monitor.observe(msg(text));
    assert.equal(update.stop, true);
    assert.match(update.reason ?? "", /repeated identical assistant explanations/);
});

test("varied assistant text does not trigger the narration guard", () => {
    const monitor = new TurnMonitor();
    const msg = (text: string) => ({
        type: "assistant",
        message: { content: [{ type: "text", text }] },
    }) as unknown as SDKMessage;

    assert.equal(monitor.observe(msg("First, I will inspect the existing layout and identify the weakest visual areas.")).stop, false);
    assert.equal(monitor.observe(msg("Now I am editing the hero section to improve contrast and spacing.")).stop, false);
    assert.equal(monitor.observe(msg("Next I will verify responsiveness and run the available checks.")).stop, false);
});


// ---- STEP 1a: Warning on 2nd identical failure, hard-stop on 3rd ----

test("injects a do-not-retry warning on the 2nd identical failure", () => {
    const monitor = new TurnMonitor();

    monitor.observe(toolUse("t1", "Bash", { command: "mkdir -p C:/Users/me/.claude/memory" }));
    const u1 = monitor.observe(toolResult("t1", "Plan approval required: Path outside workspace", true));
    assert.equal(u1.stop, false, "1st failure should not stop");
    assert.equal(u1.warning, undefined, "1st failure should not warn");

    monitor.observe(toolUse("t2", "Bash", { command: "mkdir -p C:/Users/me/.claude/memory" }));
    const u2 = monitor.observe(toolResult("t2", "Plan approval required: Path outside workspace", true));
    assert.equal(u2.stop, false, "2nd failure should not stop yet");
    assert.equal(u2.warning, "This failed 2 time(s) with the same error. Do not retry the same approach. Choose a different method or ask the user.",
        "2nd failure must inject a do-not-retry warning");
});

test("hard-stops on the 3rd identical failure", () => {
    const monitor = new TurnMonitor();

    for (const id of ["t1", "t2", "t3"]) {
        monitor.observe(toolUse(id, "Bash", { command: "mkdir -p C:/Users/me/.claude/memory" }));
        const update = monitor.observe(toolResult(id, "Plan approval required: Path outside workspace", true));
        if (id === "t3") {
            assert.equal(update.stop, true, "3rd identical failure must hard-stop");
            assert.match(update.reason ?? "", /3 identical 'Bash' failures/);
            assert.match(update.reason ?? "", /did not make progress/);
        }
    }
});

// ---- STEP 1b: Cyclic pattern detection (A->B->C->A) ----

test("detects a cyclic tool-call pattern A->B->C->A", () => {
    const monitor = new TurnMonitor();

    const cycle = [
        { id: "a1", tool: "Write", input: { file_path: "plan.md" } },
        { id: "b1", tool: "Edit", input: { file_path: "plan.md", old_text: "x", new_text: "y" } },
        { id: "c1", tool: "Write", input: { file_path: "MEMORY.md" } },
        { id: "a2", tool: "Write", input: { file_path: "plan.md" } },
        { id: "b2", tool: "Edit", input: { file_path: "plan.md", old_text: "x", new_text: "y" } },
        { id: "c2", tool: "Write", input: { file_path: "MEMORY.md" } },
    ];

    let stopped = false;
    let reason = "";
    for (const step of cycle) {
        monitor.observe(toolUse(step.id, step.tool, step.input));
        monitor.observe(toolResult(step.id, "ok"));
        const update = monitor.observe(toolResult(step.id, "ok"));
        if (update.stop) {
            stopped = true;
            reason = update.reason ?? "";
        }
    }

    assert.equal(stopped, true, "cyclic pattern A->B->C->A must stop");
    assert.match(reason, /cyclic tool-call pattern/);
});

// ---- STEP 1c: No-op-success detection (same write, no state change) ----

test("detects non-productive repeated writes to the same path", () => {
    const monitor = new TurnMonitor();

    for (const id of ["t1", "t2", "t3"]) {
        monitor.observe(toolUse(id, "Write", { file_path: "src/plan.md", content: "# same content" }));
        const update = monitor.observe(toolResult(id, "ok"));
        if (id === "t3") {
            assert.equal(update.stop, true, "3rd non-productive write must stop");
            assert.match(update.reason ?? "", /non-productive writes/);
        }
    }
});

// ---- STEP 1d: The exact original session cycle ----

test("replay of the original memory-loop cycle stops within 3 repetitions", () => {
    const monitor = new TurnMonitor();

    const cycle = [
        { id: "m1", tool: "Bash", input: { command: "mkdir -p \"C:/Users/MUSTAFA/.claude/projects/G--figma-site/memory\"" }, fail: true, error: "Plan approval required before using 'Bash'" },
        { id: "m2", tool: "Edit", input: { file_path: ".node-cli/project/plan.md", old_text: "Approval Status: none", new_text: "Approval Status: approved" }, fail: false, error: undefined },
        { id: "m3", tool: "Write", input: { file_path: "C:/Users/MUSTAFA/.claude/projects/G--figma-site/memory/MEMORY.md", content: "plan.md updated" }, fail: false, error: undefined },
        { id: "m4", tool: "Bash", input: { command: "mkdir -p \"C:/Users/MUSTAFA/.claude/projects/G--figma-site/memory\"" }, fail: true, error: "Plan approval required before using 'Bash'" },
        { id: "m5", tool: "Edit", input: { file_path: ".node-cli/project/plan.md", old_text: "Approval Status: none", new_text: "Approval Status: approved" }, fail: false, error: undefined },
        { id: "m6", tool: "Write", input: { file_path: "C:/Users/MUSTAFA/.claude/projects/G--figma-site/memory/MEMORY.md", content: "plan.md updated" }, fail: false, error: undefined },
        { id: "m7", tool: "Bash", input: { command: "mkdir -p \"C:/Users/MUSTAFA/.claude/projects/G--figma-site/memory\"" }, fail: true, error: "Plan approval required before using 'Bash'" },
    ];

    let stops = 0;
    let stopAtStep = -1;
    for (const step of cycle) {
        monitor.observe(toolUse(step.id, step.tool, step.input));
        const update = monitor.observe(toolResult(step.id, step.error ?? "ok", step.fail));
        stopAtStep++;
        if (update.stop) {
            stops++;
            break;
        }
    }

    assert.equal(stops, 1, "must stop within 3 repetitions of the cycle");
    assert.ok(stopAtStep < cycle.length, `stopped at step ${stopAtStep} of ${cycle.length} (within 3 repetitions)`);
    assert.match(monitor.summary().writesAttempted.join(", "), /MEMORY\.md/, "must record the memory-file write attempt");
});