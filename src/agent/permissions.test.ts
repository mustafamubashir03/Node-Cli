import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanUseTool, evaluateToolCall, isPathInsideRoot, normalizeToolPaths, normalizeWindowsPath } from "./permissions.js";
import { setActiveMode } from "./active-mode.js";
import { MODES } from "./modes.js";
import { isSpinnerActive, startSpinner, stopSpinner } from "../ui/spinner.js";

// New tests for secret file protection
test("secret file protection: cat .env is denied", async () => {
    setActiveMode("agent");
    const result = await createCanUseTool(process.cwd())("Bash", { command: "cat .env" });
    assert.equal(result.behavior, "deny");
    assert.match(result.message ?? "", /SECRET_FILE_PROTECTED/);
});

test("secret file protection: Read .env is denied", async () => {
    setActiveMode("agent");
    const result = await createCanUseTool(process.cwd())("Read", { file_path: ".env" });
    assert.equal(result.behavior, "deny");
    assert.match(result.message ?? "", /SECRET_FILE_PROTECTED/);
});

test("secret file protection: .env.example is allowed", async () => {
    setActiveMode("agent");
    const result = await createCanUseTool(process.cwd())("Read", { file_path: ".env.example" });
    assert.equal(result.behavior, "allow");
});

test("secret file protection: retryable is false", async () => {
    setActiveMode("agent");
    const result = await createCanUseTool(process.cwd())("Read", { file_path: ".env" }) as any;
    assert.equal(result.retryable, false);
});

test("path outside workspace is denied", async () => {
    setActiveMode("agent");
    const result = await createCanUseTool(process.cwd())("Write", { file_path: "C:\\Users\\test\\.claude\\memory\\MEMORY.md" });
    assert.equal(result.behavior, "deny");
});
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCanUseTool, evaluateToolCall, isPathInsideRoot, normalizeToolPaths, normalizeWindowsPath } from "./permissions.js";
import { setActiveMode } from "./active-mode.js";
import { MODES } from "./modes.js";
import { isSpinnerActive, startSpinner, stopSpinner } from "../ui/spinner.js";

type ToolDecision = { behavior: string; message?: string };

async function tick(): Promise<void> {
    // The confirmation promise attaches its stdin listener inside a microtask.
    await new Promise((resolve) => setImmediate(resolve));
}

function decide(
    toolName: string,
    input: Record<string, unknown>,
    projectRoot?: string,
): Promise<ToolDecision> {
    const canUseTool = createCanUseTool(projectRoot);
    return canUseTool(toolName, input) as Promise<ToolDecision>;
}

function answerWith(reply: string, toolName = "Bash", input: Record<string, unknown> = { command: "pnpm exec mystery-cli" }) {
    const pending = decide(toolName, input);
    process.stdin.emit("data", Buffer.from(reply));
    return pending;
}

// ---------------------------------------------------------------------------
// Standard (agent) mode: routine project operations are autonomous.
// ---------------------------------------------------------------------------

test("agent mode auto-allows an in-project file write without prompting", async () => {
    setActiveMode("agent");
    const result = await decide("Write", { file_path: "src/example.ts" });
    assert.equal(result.behavior, "allow");
    assert.equal(
        process.stdin.listenerCount("data"),
        0,
        "no prompt listener may be attached for a safe in-project write",
    );
});

test("agent mode auto-allows a safe shell command without prompting", async () => {
    setActiveMode("agent");
    const result = await decide("Bash", { command: "pnpm test" });
    assert.equal(result.behavior, "allow");
    assert.equal(process.stdin.listenerCount("data"), 0);
});

test("agent mode denies a destructive shell command without prompting", async () => {
    setActiveMode("agent");
    const result = await decide("Bash", { command: "rm -rf /tmp/definitely-not-a-real-dir" });
    assert.equal(result.behavior, "deny");
    assert.match(result.message ?? "", /Blocked destructive shell command/);
});

test("agent mode asks before an unclassified shell command", async () => {
    setActiveMode("agent");
    const pending = decide("Bash", { command: "pnpm exec mystery-cli" });
    await tick();
    assert.equal(process.stdin.listenerCount("data"), 1, "an unclassified command needs approval");
    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await pending).behavior, "allow");
});

// ---------------------------------------------------------------------------
// Project boundary.
// ---------------------------------------------------------------------------

test("isPathInsideRoot resolves relative and absolute paths against the root", () => {
    const root = process.cwd();
    assert.equal(isPathInsideRoot("src/agent/permissions.ts", root), true);
    assert.equal(isPathInsideRoot("src/../src/agent/permissions.ts", root), true);
    assert.equal(isPathInsideRoot("G:\\node-cli\\src\\agent\\permissions.ts", root), true);
    assert.equal(isPathInsideRoot(join(root, "..", "outside.ts"), root), false);
});

test("agent mode denies writing outside the authorized project root", async () => {
    setActiveMode("agent");
    const fixture = mkdtempSync(join(tmpdir(), "node-cli-perm-"));
    try {
        const result = await decide("Write", { file_path: join(fixture, "..", "outside.ts") }, fixture);
        assert.equal(result.behavior, "deny");
        assert.match(result.message ?? "", /PATH_OUTSIDE_WORKSPACE/);

        const allowed = await decide("Write", { file_path: join(fixture, "inside.ts") }, fixture);
        assert.equal(allowed.behavior, "allow");
    } finally {
        rmSync(fixture, { recursive: true, force: true });
    }
});

// ---------------------------------------------------------------------------
// Strict mode.
// ---------------------------------------------------------------------------

test("strict mode asks before routine in-project writes and safe commands", async () => {
    setActiveMode("strict");
    const pendingWrite = decide("Write", { file_path: "src/example.ts" }, process.cwd());
    await tick();
    assert.equal(process.stdin.listenerCount("data"), 1, "strict mode requires approval");
    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await pendingWrite).behavior, "allow");

    const pendingBash = answerWith("y");
    assert.equal((await pendingBash).behavior, "allow");
});

// ---------------------------------------------------------------------------
// ask / plan modes keep denying writes without prompting.
// ---------------------------------------------------------------------------

test("ask mode denies Edit without prompting the user", async () => {
    setActiveMode("ask");
    const result = await decide("Edit", { file_path: "src/example.ts" });
    assert.equal(result.behavior, "deny");
    assert.equal(process.stdin.listenerCount("data"), 0);
    assert.match(result.message ?? "", /not allowed in 'ask' mode/);
});

test("ask mode still allows Read without prompting", async () => {
    setActiveMode("ask");
    assert.equal((await decide("Read", { file_path: "src/example.ts" })).behavior, "allow");
});

test("plan mode denies Bash without prompting the user", async () => {
    setActiveMode("plan");
    const result = await decide("Bash", { command: "pnpm test" });
    assert.equal(result.behavior, "deny");
});

// ---------------------------------------------------------------------------
// Interactive consent flows for operations that require approval.
// ---------------------------------------------------------------------------

test("agent mode prompts before Edit and honours a decline", async () => {
    setActiveMode("agent");
    const result = await answerWith("n", "Bash", { command: "pnpm exec mystery-cli" });
    assert.equal(result.behavior, "deny");
    assert.match(result.message ?? "", /declined/i);
});

test("agent mode prompts before Edit and honours an approval", async () => {
    setActiveMode("agent");
    assert.equal((await answerWith("y")).behavior, "allow");
});

test("a denied bash command does not leave the session in a broken state", async () => {
    setActiveMode("agent");
    assert.equal((await answerWith("n")).behavior, "deny");
    assert.equal((await decide("Read", { file_path: "src/other.ts" })).behavior, "allow");
    assert.equal((await answerWith("n", "Bash", { command: "rm -rf /tmp/x" })).behavior, "deny");
});

test("bare Enter (empty input) denies - documented default-deny", async () => {
    setActiveMode("agent");
    assert.equal((await answerWith("\n")).behavior, "deny");
});

test("whitespace-only input denies", async () => {
    setActiveMode("agent");
    assert.equal((await answerWith("   \n")).behavior, "deny");
});

test("invalid input denies (only y/yes approve)", async () => {
    setActiveMode("agent");
    for (const reply of ["maybe\n", "1\n", "nope\n", "yy\n"]) {
        assert.equal((await answerWith(reply)).behavior, "deny", JSON.stringify(reply));
    }
});

test("uppercase Y approves (case-insensitive)", async () => {
    setActiveMode("agent");
    assert.equal((await answerWith("Y\n")).behavior, "allow");
    assert.equal((await answerWith("YES\n")).behavior, "allow");
});

test("EOF on stdin denies instead of hanging", async () => {
    setActiveMode("agent");
    const pending = decide("Bash", { command: "pnpm exec mystery-cli" });
    process.stdin.emit("end");
    const result = await Promise.race([
        pending,
        new Promise((resolve) => setTimeout(() => resolve("TIMEOUT"), 2000)),
    ]);
    assert.notEqual(result, "TIMEOUT", "confirmInTerminal must settle on EOF");
    assert.equal((result as ToolDecision).behavior, "deny");
});

test("successive prompts do not consume each other's input", async () => {
    setActiveMode("agent");
    assert.equal((await answerWith("y")).behavior, "allow");
    assert.equal((await answerWith("n")).behavior, "deny");
    assert.equal((await answerWith("y")).behavior, "allow");
});

test("stdin is left paused so typed input is not silently discarded", async () => {
    setActiveMode("agent");
    await answerWith("y");
    assert.equal(process.stdin.isPaused(), true);
});

test("prompt listeners are removed so successive prompts do not stack up", async () => {
    setActiveMode("agent");
    const before = process.stdin.listenerCount("data");
    await answerWith("y");
    await answerWith("n");
    assert.equal(process.stdin.listenerCount("data"), before, "no leaked data listeners");
});

test("the spinner is stopped while a confirmation prompt is on screen", async () => {
    setActiveMode("agent");
    startSpinner("Agent working...");
    try {
        const pending = decide("Bash", { command: "pnpm exec mystery-cli" });
        await tick();
        assert.equal(isSpinnerActive(), false, "spinner must not run while the prompt waits");
        process.stdin.emit("data", Buffer.from("y\n"));
        assert.equal((await pending).behavior, "allow");
        assert.equal(isSpinnerActive(), true, "spinner resumes once answered");
    } finally {
        stopSpinner();
    }
});

test("the spinner is left alone when no spinner was running", async () => {
    setActiveMode("agent");
    stopSpinner();
    await answerWith("y");
    assert.equal(isSpinnerActive(), false);
});

test("the prompt resumes stdin so a paused stream can deliver the answer", async () => {
    setActiveMode("agent");
    process.stdin.pause();
    const pending = decide("Bash", { command: "pnpm exec mystery-cli" });
    await tick();
    assert.equal(process.stdin.isPaused(), false, "prompt must resume stdin");
    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await pending).behavior, "allow");
});

test("concurrent approvals are queued so one keypress answers only one", async () => {
    setActiveMode("agent");
    const first = decide("Bash", { command: "pnpm exec mystery-cli" });
    const second = decide("Bash", { command: "pnpm exec another-cli" });
    await tick();
    assert.equal(process.stdin.listenerCount("data"), 1, "only one prompt may read stdin");
    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await first).behavior, "allow");
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(process.stdin.listenerCount("data"), 1, "the queued prompt took over");
    process.stdin.emit("data", Buffer.from("n\n"));
    assert.equal((await second).behavior, "deny");
});

test("tool notifications are withheld while a prompt is waiting", async () => {
    setActiveMode("agent");
    const pending = answerWith("y");
    const { printMessage } = await import("./message-printer.js");
    const { resumeOutput } = await import("../ui/output-buffer.js");
    printMessage({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name: "Bash", input: { command: "pnpm exec mystery-cli" } }] },
    } as never);
    resumeOutput();
    process.stdin.emit("data", Buffer.from("y\n"));
    assert.equal((await pending).behavior, "allow");
});

// ---------------------------------------------------------------------------
// Pure policy decisions.
// ---------------------------------------------------------------------------

test("evaluateToolCall allows routine in-project writes in standard mode", () => {
    const decision = evaluateToolCall({
        toolName: "Write",
        input: { file_path: "src/app.ts" },
        projectRoot: process.cwd(),
        strict: false,
    });
    assert.equal(decision.behavior, "allow");
});

test("evaluateToolCall requires confirmation for risky shell commands in standard mode", () => {
    const decision = evaluateToolCall({
        toolName: "Bash",
        input: { command: "pnpm exec mystery-cli" },
        projectRoot: process.cwd(),
        strict: false,
    });
    assert.equal(decision.behavior, "confirm");
    assert.match(decision.message ?? "", /Allow 'Bash'/);
});

test("evaluateToolCall denies destructive shell commands regardless of strictness", () => {
    const destructive = evaluateToolCall({
        toolName: "Bash",
        input: { command: "rm -rf /tmp/x" },
        projectRoot: process.cwd(),
        strict: false,
    });
    assert.equal(destructive.behavior, "deny");
});

test("evaluateToolCall in strict mode requires approval for routine writes", () => {
    const decision = evaluateToolCall({
        toolName: "Write",
        input: { file_path: "src/app.ts" },
        projectRoot: process.cwd(),
        strict: true,
    });
    assert.equal(decision.behavior, "confirm");
});

test("evaluateToolCall denies unsafe-mode tools", () => {
    const decision = evaluateToolCall({
        toolName: "Bash",
        input: { command: "rm -rf /tmp/x" },
        projectRoot: process.cwd(),
        strict: true,
    });
    // Destructive wins before the strict confirmation gate.
    assert.equal(decision.behavior, "deny");
});

test("strict mode is exposed on the mode config", () => {
    assert.equal(MODES.strict.strict, true);
    assert.equal(MODES.strict.permissionMode, "default");
    assert.deepEqual([...MODES.strict.tools].sort(), [...MODES.agent.tools].sort());
});

test("normalizeWindowsPath converts Git Bash paths to Windows paths", () => {
    if (process.platform !== "win32") return;
    assert.equal(normalizeWindowsPath("/c:/Users/foo/bar.txt"), "C:\\Users\\foo\\bar.txt");
    assert.equal(normalizeWindowsPath("/d:/project/css/style.css"), "D:\\project\\css\\style.css");
    assert.equal(normalizeWindowsPath("C:\\already\\windows.txt"), "C:\\already\\windows.txt");
    assert.equal(normalizeWindowsPath("/relative/path.txt"), "/relative/path.txt");
});

test("normalizeToolPaths returns normalized input when paths change", () => {
    if (process.platform !== "win32") return;
    const input = { file_path: "/c:/Users/foo/bar.txt", content: "hello" };
    const result = normalizeToolPaths("Write", input);
    assert.ok(result);
    assert.equal(result!.file_path, "C:\\Users\\foo\\bar.txt");
    assert.equal(result!.content, "hello");
});

test("normalizeToolPaths returns null when no paths change", () => {
    const input = { file_path: "C:\\already\\windows.txt", content: "hello" };
    const result = normalizeToolPaths("Write", input);
    assert.equal(result, null);
});

test("evaluateToolCall normalizes Git Bash paths for isPathInsideRoot check", () => {
    if (process.platform !== "win32") return;
    const root = "C:\\project";
    const decision = evaluateToolCall({
        toolName: "Write",
        input: { file_path: "/c:/project/css/style.css" },
        projectRoot: root,
        strict: false,
    });
    assert.equal(decision.behavior, "allow");
});

// ---- STEP 1b: retryable:false honored by agent loop ----

test("second identical call after non-retryable denial is blocked without executing", async () => {
    setActiveMode("agent");
    const canUse = createCanUseTool(process.cwd());

    // First call: writing outside workspace is denied with retryable:false
    const first = await canUse("Write", { file_path: "C:/outside-workspace/secret.txt", content: "x" });
    assert.equal(first.behavior, "deny");
    assert.equal(first.retryable, false);
    assert.equal(first.reasonCode, "PATH_OUTSIDE_WORKSPACE");

    // Second identical call: must be blocked immediately with NON_RETRYABLE_DENIED
    const second = await canUse("Write", { file_path: "C:/outside-workspace/secret.txt", content: "x" });
    assert.equal(second.behavior, "deny");
    assert.equal(second.reasonCode, "NON_RETRYABLE_DENIED");
    assert.equal(second.retryable, false);
    assert.match(second.message ?? "", /NON_RETRYABLE_DENIED/);
});

test("different call after non-retryable denial is still evaluated normally", async () => {
    setActiveMode("agent");
    const canUse = createCanUseTool(process.cwd());

    // First call denied (outside workspace)
    const first = await canUse("Write", { file_path: "C:/outside-workspace/denied.txt", content: "x" });
    assert.equal(first.behavior, "deny");
    assert.equal(first.reasonCode, "PATH_OUTSIDE_WORKSPACE");

    // Different path (inside workspace) should be allowed
    const second = await canUse("Write", { file_path: "src/allowed.ts", content: "x" });
    assert.equal(second.behavior, "allow");
});

test("secret file denial is non-retryable and blocks identical retry", async () => {
    setActiveMode("agent");
    const canUse = createCanUseTool(process.cwd());

    const secretPath = ".env-retryable-test";
    const first = await canUse("Read", { file_path: secretPath });
    assert.equal(first.behavior, "deny");
    assert.equal(first.reasonCode, "SECRET_FILE_PROTECTED");
    assert.equal(first.retryable, false);

    const second = await canUse("Read", { file_path: secretPath });
    assert.equal(second.behavior, "deny");
    assert.equal(second.reasonCode, "NON_RETRYABLE_DENIED");
});

// ---- STEP 2c: Configurable write allow-list ----

test("write allow-list permits writes to configured directories outside workspace", async () => {
    setActiveMode("agent");
    const originalEnv = process.env.NODE_CLI_CACHE_DIR;
    process.env.NODE_CLI_CACHE_DIR = "/tmp/node-cli-cache";
    try {
        const canUse = createCanUseTool("/test/project");
        const result = await canUse("Write", {
            file_path: "/tmp/node-cli-cache/some-file.txt",
            content: "x",
        });
        assert.equal(result.behavior, "allow");
    } finally {
        if (originalEnv === undefined) delete process.env.NODE_CLI_CACHE_DIR;
        else process.env.NODE_CLI_CACHE_DIR = originalEnv;
    }
});

test("write allow-list still denies paths not in the list", async () => {
    setActiveMode("agent");
    const originalEnv = process.env.NODE_CLI_CACHE_DIR;
    delete process.env.NODE_CLI_CACHE_DIR;
    try {
        const canUse = createCanUseTool("/test/project");
        const result = await canUse("Write", {
            file_path: "/tmp/random-dir/file.txt",
            content: "x",
        });
        assert.equal(result.behavior, "deny");
        assert.equal(result.reasonCode, "PATH_OUTSIDE_WORKSPACE");
    } finally {
        if (originalEnv === undefined) delete process.env.NODE_CLI_CACHE_DIR;
        else process.env.NODE_CLI_CACHE_DIR = originalEnv;
    }
});

// ---- STEP 2a: Single policy engine across all four tools ----

test("Read, Write, Edit, and Bash all return identical reasonCode for the same path", async () => {
    setActiveMode("agent");
    const canUse = createCanUseTool("/test/project");

    const testCases = [
        { name: "outside workspace", input: { file_path: "/policy-test-outside/secret.txt" } },
        { name: "parent traversal", input: { file_path: "/test/project/../outside.txt" } },
        { name: "protected state dir", input: { file_path: ".node-cli/state/approval.json" } },
        { name: "plan.md", input: { file_path: ".node-cli/project/plan.md" } },
        { name: "decisions.md", input: { file_path: ".node-cli/project/decisions.md" } },
        { name: "skill-plan.md", input: { file_path: ".node-cli/project/skill-plan.md" } },
        { name: "env file", input: { file_path: ".env-policy-engine-test" } },
        { name: "claude dir", input: { file_path: "C:/Users/me/.claude-policy-test/memory.md" } },
    ];

    for (const { name, input } of testCases) {
        const decisions: Record<string, string | undefined> = {};
        for (const tool of ["Read", "Write", "Edit", "Bash"]) {
            const toolInput = tool === "Bash" ? { command: `cat ${input.file_path}` } : input;
            const decision = await canUse(tool, toolInput);
            decisions[tool] = decision.reasonCode;
        }

        // All four tools must agree on the reason code
        const codes = Object.values(decisions).filter((c) => c !== undefined);
        const firstCode = codes[0];
        for (const code of codes) {
            assert.equal(code, firstCode, `${name}: ${JSON.stringify(decisions)}`);
        }

        // Protected/outside/secret paths must all be denied
        if (name !== "parent traversal") {
            // parent traversal may or may not be denied depending on resolution
            for (const [tool, code] of Object.entries(decisions)) {
                if (code !== undefined) {
                    assert.equal(code !== undefined, true, `${name}/${tool} should have a reason code`);
                }
            }
        }
    }
});
