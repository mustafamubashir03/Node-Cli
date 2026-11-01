import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
    assertShellSafe,
    buildWindowsCommandLine,
    detectPackageManager,
    findExecutable,
    quoteWindowsArgument,
    runCommand,
} from "./command-runner.js";

test("quotes only arguments that contain whitespace", () => {
    assert.equal(quoteWindowsArgument("--template"), "--template");
    assert.equal(quoteWindowsArgument("C:\\my project"), '"C:\\my project"');
});

test("builds a quoted Windows command line for a path with spaces", () => {
    const line = buildWindowsCommandLine("pnpm", [
        "dlx",
        "create-vite@latest",
        "C:\\my project\\app",
        "--template",
        "react-ts",
    ]);
    assert.match(line, /^pnpm dlx create-vite@latest "C:\\my project\\app" --template react-ts$/);
});

test("rejects Windows shell metacharacters instead of escaping them", () => {
    for (const unsafe of ["a & calc", "a | calc", "100%PATH%", 'a"b', "a\nb", "a;b"]) {
        assert.throws(
            () => buildWindowsCommandLine("pnpm", [unsafe]),
            /cannot be passed safely/,
            unsafe,
        );
    }
    assert.throws(() => buildWindowsCommandLine("pnpm & calc", []), /unsafe command name/);
});

test("accepts ordinary Windows and POSIX paths", () => {
    assert.doesNotThrow(() => assertShellSafe("C:\\Program Files\\my project\\app", "Target path"));
    assert.doesNotThrow(() => assertShellSafe("/home/user/my project/app", "Target path"));
    assert.throws(() => assertShellSafe("C:\\tmp\\a&b", "Target path"), /cannot be passed safely/);
});

test("finds the running node executable and rejects a missing command", () => {
    assert.equal(findExecutable(process.execPath), process.execPath);
    assert.equal(findExecutable("node-cli-definitely-not-installed"), null);
});

test("detects the package manager from a lockfile in the current directory", () => {
    const root = mkdtempSync(join(tmpdir(), "node-cli-pm-"));
    try {
        mkdirSync(join(root, "nested", "project"), { recursive: true });
        writeFileSync(join(root, "pnpm-lock.yaml"), "");
        writeFileSync(join(root, "package-lock.json"), "");

        assert.equal(
            detectPackageManager(join(root, "nested", "project"), {
                available: () => true,
                env: {},
            }),
            "pnpm",
        );

        rmSync(join(root, "pnpm-lock.yaml"));
        assert.equal(
            detectPackageManager(join(root, "nested", "project"), {
                available: () => true,
                env: {},
            }),
            "npm",
        );

        rmSync(join(root, "package-lock.json"));
        writeFileSync(join(root, "yarn.lock"), "");
        assert.equal(
            detectPackageManager(join(root, "nested", "project"), {
                available: () => true,
                env: {},
            }),
            "yarn",
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});

test("an explicit package manager override wins when it is installed", () => {
    assert.equal(
        detectPackageManager(process.cwd(), {
            available: () => true,
            env: { NODE_CLI_PACKAGE_MANAGER: "yarn" },
        }),
        "yarn",
    );
    assert.equal(
        detectPackageManager(process.cwd(), {
            available: (manager) => manager !== "yarn",
            env: { NODE_CLI_PACKAGE_MANAGER: "yarn", npm_config_user_agent: "pnpm/12.0.0" },
        }),
        "pnpm",
    );
});

test("runs a real command without a shell", () => {
    const result = runCommand(process.execPath, ["-p", "'runner-ok'"], { stdio: "pipe" });
    assert.equal(result.error, null);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /runner-ok/);
});

test("a missing command is reported instead of throwing", () => {
    const result = runCommand("node-cli-definitely-not-installed", [], { stdio: "pipe" });
    assert.ok(result.error !== null || result.status !== 0);
});

test("rejects an unsafe argument before starting a process", () => {
    assert.throws(
        () => runCommand("node", ["-e", "console.log('a & b')"], { stdio: "pipe" }),
        /cannot be passed safely/,
    );
});

test(
    "runs a .cmd shim from a path containing spaces",
    { skip: process.platform !== "win32" },
    () => {
        const directory = mkdtempSync(join(tmpdir(), "node cli runner-"));
        const script = join(directory, "say hello.cmd");
        writeFileSync(script, "@echo off\r\necho ARG=[%~1]\r\n");

        try {
            const result = runCommand(script, ["a b"], { stdio: "pipe" });
            assert.equal(result.error, null);
            assert.equal(result.status, 0);
            assert.match(result.stdout, /ARG=\[a b\]/);
        } finally {
            rmSync(directory, { recursive: true, force: true });
        }
    },
);
