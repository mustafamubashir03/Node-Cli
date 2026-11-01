import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getStack, type StackDefinition } from "../config/stacks.js";
import type { CommandResult } from "./command-runner.js";
import { hasTestFiles, verifyProject, type VerifyExecutor } from "./verify-project.js";

function writePackage(dir: string, scripts: Record<string, string>): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ scripts }, null, 2));
}

function withTempDir(run: (dir: string) => void): void {
    const dir = mkdtempSync(join(tmpdir(), "verify-"));
    try {
        run(dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

function okResult(): CommandResult {
    return { command: "pnpm", status: 0, stdout: "", stderr: "", error: null };
}

function recordingExecutor(calls: { args: string[]; cwd: string }[], result: CommandResult = okResult()): VerifyExecutor {
    return (command, args, options) => {
        calls.push({ args: [...args], cwd: options.cwd });
        return { ...result, command };
    };
}

const customStack: StackDefinition = {
    id: "custom",
    name: "Custom",
    family: "frontend",
    languages: ["ts"],
    description: "test stack",
    scaffold: null,
    verify: ["typecheck", "build", "test"],
    docs: "https://example.invalid",
    verifiedAt: "2026-01-01",
};

test("react-vite verification runs its build script and does not invent a typecheck", () => {
    withTempDir((dir) => {
        writePackage(dir, { build: "tsc -b && vite build" });
        const calls: { args: string[]; cwd: string }[] = [];

        const result = verifyProject(getStack("react-vite")!, dir, "pnpm", {
            executor: recordingExecutor(calls),
        });

        assert.equal(result.ok, true);
        assert.equal(result.steps.length, 1);
        assert.equal(result.steps[0].concept, "build");
        assert.equal(result.steps[0].status, "passed");
        assert.deepEqual(calls, [{ args: ["run", "build"], cwd: dir }]);
    });
});

test("missing scripts are reported as skipped, never as passed", () => {
    withTempDir((dir) => {
        writePackage(dir, { dev: "tsx src/index.ts", start: "node dist/index.js" });
        const calls: { args: string[]; cwd: string }[] = [];

        const result = verifyProject(getStack("express-api")!, dir, "pnpm", {
            executor: recordingExecutor(calls),
        });

        assert.equal(result.ok, true);
        assert.deepEqual(
            result.steps.map((step) => step.status),
            ["skipped", "skipped"],
        );
        assert.ok(result.steps.every((step) => /No "(typecheck|test)" script/.test(step.reason ?? "")));
        assert.equal(calls.length, 0);
    });
});

test("a test script is skipped when no test files exist", () => {
    withTempDir((dir) => {
        writePackage(dir, { test: "node --test" });
        const calls: { args: string[]; cwd: string }[] = [];

        const result = verifyProject(customStack, dir, "pnpm", {
            executor: recordingExecutor(calls),
        });

        const testStep = result.steps.find((step) => step.concept === "test")!;
        assert.equal(testStep.status, "skipped");
        assert.match(testStep.reason ?? "", /no test files/);
        assert.equal(calls.length, 0);
    });
});

test("a test script runs when test files exist", () => {
    withTempDir((dir) => {
        writePackage(dir, { test: "node --test" });
        mkdirSync(join(dir, "src"), { recursive: true });
        writeFileSync(join(dir, "src", "app.test.ts"), "// test\n");
        const calls: { args: string[]; cwd: string }[] = [];

        const result = verifyProject(customStack, dir, "pnpm", {
            executor: recordingExecutor(calls),
        });

        const testStep = result.steps.find((step) => step.concept === "test")!;
        assert.equal(testStep.status, "passed");
        assert.deepEqual(calls, [{ args: ["run", "test"], cwd: dir }]);
    });
});

test("a failing command makes verification fail with the exit code", () => {
    withTempDir((dir) => {
        writePackage(dir, { build: "vite build" });
        const result = verifyProject(getStack("react-vite")!, dir, "pnpm", {
            executor: recordingExecutor([], {
                command: "pnpm",
                status: 2,
                stdout: "",
                stderr: "boom",
                error: null,
            }),
        });

        assert.equal(result.ok, false);
        assert.equal(result.steps[0].status, "failed");
        assert.equal(result.steps[0].exitCode, 2);
        assert.match(result.steps[0].reason ?? "", /status 2/);
    });
});

test("a process-start error is reported as a failed step", () => {
    withTempDir((dir) => {
        writePackage(dir, { build: "vite build" });
        const error = Object.assign(new Error("spawn failed"), { code: "ENOENT" }) as NodeJS.ErrnoException;
        const result = verifyProject(getStack("react-vite")!, dir, "pnpm", {
            executor: () => ({ command: "pnpm", status: null, stdout: "", stderr: "", error }),
        });

        assert.equal(result.ok, false);
        assert.equal(result.steps[0].status, "failed");
        assert.match(result.steps[0].reason ?? "", /spawn failed/);
    });
});

test("root build scripts run once instead of once per package", () => {
    withTempDir((dir) => {
        writePackage(dir, { build: "npm run build:client && npm run build:server" });
        writePackage(join(dir, "client"), { build: "vite build" });
        writePackage(join(dir, "server"), { build: "tsc" });
        const calls: { args: string[]; cwd: string }[] = [];

        const stack: StackDefinition = { ...customStack, verify: ["build"] };
        const result = verifyProject(stack, dir, "pnpm", {
            executor: recordingExecutor(calls),
        });

        assert.equal(result.steps.length, 1);
        assert.equal(calls.length, 1);
        assert.equal(calls[0].cwd, dir);
    });
});

test("nested packages are verified when the root does not own a script", () => {
    withTempDir((dir) => {
        writePackage(dir, { dev: "concurrently" });
        writePackage(join(dir, "client"), { typecheck: "tsc --noEmit" });
        writePackage(join(dir, "server"), { typecheck: "tsc --noEmit" });
        const calls: { args: string[]; cwd: string }[] = [];

        const stack: StackDefinition = { ...customStack, verify: ["typecheck"] };
        const result = verifyProject(stack, dir, "pnpm", {
            executor: recordingExecutor(calls),
        });

        assert.equal(result.steps.length, 2);
        assert.deepEqual(
            result.steps.map((step) => step.dir),
            [join(dir, "client"), join(dir, "server")],
        );
        assert.deepEqual(
            calls.map((call) => call.args),
            [["run", "typecheck"], ["run", "typecheck"]],
        );
    });
});

test("an unknown verification concept is skipped with an explanation", () => {
    withTempDir((dir) => {
        writePackage(dir, { build: "vite build" });
        const stack: StackDefinition = { ...customStack, verify: ["build", "lint"] };

        const result = verifyProject(stack, dir, "pnpm", {
            executor: recordingExecutor([]),
        });

        const skipped = result.steps.find((step) => step.status === "skipped")!;
        assert.match(skipped.reason ?? "", /Unknown verification concept "lint"/);
    });
});

test("hasTestFiles finds nested specs and ignores dependencies and build output", () => {
    withTempDir((dir) => {
        mkdirSync(join(dir, "node_modules", "pkg", "tests"), { recursive: true });
        writeFileSync(join(dir, "node_modules", "pkg", "tests", "x.test.js"), "//\n");
        mkdirSync(join(dir, "dist"), { recursive: true });
        writeFileSync(join(dir, "dist", "x.spec.js"), "//\n");
        assert.equal(hasTestFiles(dir), false);

        mkdirSync(join(dir, "src", "components"), { recursive: true });
        writeFileSync(join(dir, "src", "components", "Button.spec.tsx"), "//\n");
        assert.equal(hasTestFiles(dir), true);
    });
});
