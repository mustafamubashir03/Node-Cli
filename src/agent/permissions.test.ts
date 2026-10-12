import { test } from "node:test";
import assert from "node:assert/strict";
import { buildModeOptions, CliModeToPermissionMode, setCurrentMode, MODES } from "../agent/modes.js";
import { createCanUseTool } from "../agent/permissions.js";
import { startSpinner, stopSpinner, isSpinnerActive, resumeSpinner, suspendSpinner } from "../ui/spinner.js";

/**
 * The SDK documents 'default' as the mode that "keeps manual approvals through
 * canUseTool". These pin that agent mode keeps that, and that the confirmation
 * is reachable. They do not prove how the native subprocess orders the two gates.
 */

test("agent mode does not use a permissionMode that auto-accepts edits", () => {
    const agent: any = buildModeOptions("agent");
    assert.equal(agent.permissionMode, "default");
    assert.notEqual(MODES.agent.permissionMode, "acceptEdits");
});

/** Drives the real prompt by emitting the `data` event its listener waits for. */
async function answer(answer: string, tool = "Edit") {
    const can: any = createCanUseTool();
    const pending = can(tool, { file_path: "src/example.ts", command: "echo hi" });
    process.stdin.emit("data", Buffer.from(answer));
    return pending;
}

test("agent mode prompts before Edit and honours a decline", async () => {
    setCurrentMode("agent");
    const result = await answer("n");
    assert.equal(result.behavior, "deny");
    assert.match(result.message, /declined/i);
});

test("agent mode prompts before Edit and honours an approval", async () => {
    setCurrentMode("agent");
    const result = await answer("y");
    assert.equal(result.behavior, "allow");
});

test("ask/plan mode deny Edit without prompting the user", async () => {
    setCurrentMode("ask");
    const can: any = createCanUseTool();
    const result = await can("Edit", { file_path: "src/example.ts" });
    assert.equal(result.behavior, "deny");
    assert.match(result.message, /not allowed in 'ask' mode/);
});

test("ask mode still allows Read without prompting", async () => {
    setCurrentMode("ask");
    const can: any = createCanUseTool();
    assert.equal((await can("Read", { file_path: "src/example.ts" })).behavior, "allow");
});

test("plan mode keeps its read-only surface and denies writes", () => {
    const plan: any = buildModeOptions("plan");
    assert.equal(plan.permissionMode, "plan");
    for (const tool of plan.tools) {
        assert.ok(["Read", "Grep", "Glob", "WebSearch", "WebFetch"].includes(tool), `unexpected ${tool}`);
    }
    assert.equal(plan.tools.includes("Edit"), false);
    assert.equal(plan.tools.includes("Write"), false);
    assert.equal(plan.tools.includes("Bash"), false);
    assert.equal(plan.maxTurns, 6);
});

test("ask mode keeps its read-only surface", () => {
    const ask: any = buildModeOptions("ask");
    assert.equal(ask.permissionMode, "dontAsk");
    assert.equal(ask.tools.includes("Bash"), false);
    assert.equal(ask.maxTurns, 6);
});

test("runtime /mode transitions use the same permission mode as startup", () => {
    for (const mode of ["agent", "ask", "plan"] as const) {
        assert.equal(
            CliModeToPermissionMode(mode),
            (buildModeOptions(mode) as any).permissionMode,
            `${mode}: runtime /mode must match startup config`,
        );
    }
    assert.equal(CliModeToPermissionMode("agent"), "default");
});

test("a denied edit does not leave the session in a broken state", async () => {
    setCurrentMode("agent");
    const can: any = createCanUseTool();
    assert.equal((await answer("n")).behavior, "deny");
    assert.equal((await can("Read", { file_path: "src/other.ts" })).behavior, "allow");
    // Bash is still gated rather than silently allowed.
    assert.equal((await answer("n", "Bash")).behavior, "deny");
    assert.equal((await answer("y", "Bash")).behavior, "allow");
});

/* Input handling rather than rendering - no TTY is available in this environment. */

test("bare Enter (empty input) denies - documented default-deny", async () => {
    setCurrentMode("agent");
    assert.equal((await answer("\n")).behavior, "deny");
});

test("whitespace-only input denies", async () => {
    setCurrentMode("agent");
    assert.equal((await answer("   \n")).behavior, "deny");
});

test("invalid input denies (only y/yes approve)", async () => {
    setCurrentMode("agent");
    for (const bad of ["maybe\n", "1\n", "nope\n", "yy\n"]) {
        assert.equal((await answer(bad)).behavior, "deny", JSON.stringify(bad));
    }
});

test("uppercase Y approves (case-insensitive)", async () => {
    setCurrentMode("agent");
    assert.equal((await answer("Y\n")).behavior, "allow");
    assert.equal((await answer("YES\n")).behavior, "allow");
});

test("EOF on stdin denies instead of hanging", async () => {
    setCurrentMode("agent");
    const can: any = createCanUseTool();
    const pending = can("Edit", { file_path: "src/eof.ts" });
    process.stdin.emit("end");
    const result = await Promise.race([
        pending,
        new Promise((r) => setTimeout(() => r("TIMEOUT"), 2000)),
    ]);
    assert.notEqual(result, "TIMEOUT", "confirmWithUser must settle on EOF");
    assert.equal((result as any).behavior, "deny");
});

test("successive prompts do not consume each other's input", async () => {
    setCurrentMode("agent");
    assert.equal((await answer("y")).behavior, "allow");
    assert.equal((await answer("n")).behavior, "deny");
    assert.equal((await answer("y")).behavior, "allow");
});

test("stdin is left paused so typed input is not silently discarded", async () => {
    setCurrentMode("agent");
    await answer("y");
    // A flowing stdin with no 'data' listener drops whatever the user types next.
    assert.equal(process.stdin.isPaused(), true);
});

test("prompt listeners are removed so successive prompts do not stack up", async () => {
    setCurrentMode("agent");
    const before = process.stdin.listenerCount("data");
    await answer("y");
    await answer("n");
    assert.equal(process.stdin.listenerCount("data"), before, "no leaked data listeners");
});

/*
 * Regression: ora redraws on the line the cursor is on, so a prompt written while
 * the spinner runs is overwritten within one frame. The turn then waits forever
 * for an answer the user cannot see.
 */

test("the spinner is stopped while a confirmation prompt is on screen", async () => {
    setCurrentMode("agent");
    startSpinner("Agent working...");
    try {
        const can: any = createCanUseTool();
        const pending = can("Write", { file_path: "G:/node-cli/todo/index.html" });

        assert.equal(isSpinnerActive(), false, "spinner must not run while the prompt waits");

        process.stdin.emit("data", Buffer.from("y\n"));
        assert.equal((await pending).behavior, "allow");
        assert.equal(isSpinnerActive(), true, "spinner resumes once answered");
    } finally {
        stopSpinner();
    }
});

test("the spinner is left alone when no spinner was running", async () => {
    setCurrentMode("agent");
    stopSpinner();
    await answer("y");
    assert.equal(isSpinnerActive(), false, "must not start a spinner that was not running");
});

test("suspend and resume are idempotent", () => {
    stopSpinner();
    startSpinner("Agent working...");
    suspendSpinner();
    suspendSpinner();
    assert.equal(isSpinnerActive(), false);
    resumeSpinner();
    assert.equal(isSpinnerActive(), true, "resume restores the spinner");
    resumeSpinner();
    stopSpinner();
    assert.equal(isSpinnerActive(), false);
});

/**
 * Inquirer leaves stdin paused with a data listener still attached, and Node does
 * not resume a paused stream when a further data listener is added. Without an
 * explicit resume the prompt waits forever and the CLI appears frozen.
 */
test("the prompt resumes stdin so a paused stream can deliver the answer", async () => {
    setCurrentMode("agent");
    process.stdin.pause();
    const can: any = createCanUseTool();
    const pending = can("Edit", { file_path: "todo/index.html" });

    assert.equal(process.stdin.isPaused(), false, "prompt must resume stdin");

    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await pending).behavior, "allow");
});

test("concurrent approvals are queued so one keypress answers only one", async () => {
    setCurrentMode("agent");
    const can: any = createCanUseTool();
    const first = can("Write", { file_path: "a.txt" });
    const second = can("Write", { file_path: "b.txt" });

    // The second prompt must not be listening yet.
    assert.equal(process.stdin.listenerCount("data"), 1, "only one prompt may read stdin");

    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await first).behavior, "allow");

    await new Promise((r) => setImmediate(r));
    assert.equal(process.stdin.listenerCount("data"), 1, "the queued prompt took over");
    process.stdin.emit("data", Buffer.from("n\n"));
    assert.equal((await second).behavior, "deny");
});

test("tool notifications are withheld while a prompt is waiting", async () => {
    setCurrentMode("agent");
    const can: any = createCanUseTool();
    const pending = can("Write", { file_path: "c.txt" });
    // message-handler buffers into the same hold that resumeOutput flushes.
    const { handleMessage, resumeOutput } = await import("./message-handler.ts");
    handleMessage({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name: "Write", input: { file_path: "d.txt" } }] },
    } as any);
    resumeOutput();
    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await pending).behavior, "allow");
});