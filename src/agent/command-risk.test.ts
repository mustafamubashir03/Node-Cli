import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyShellRisk } from "./command-risk.js";

test("classifyShellRisk labels routine operations safe", () => {
    assert.equal(classifyShellRisk("pnpm test"), "safe");
    assert.equal(classifyShellRisk("npm run build"), "safe");
    assert.equal(classifyShellRisk("git status"), "safe");
    assert.equal(classifyShellRisk("git diff"), "safe");
    assert.equal(classifyShellRisk("pnpm add zod"), "safe");
    assert.equal(classifyShellRisk("pnpm dev"), "safe");
});

test("classifyShellRisk labels destructive operations dangerous", () => {
    assert.equal(classifyShellRisk("rm -rf /tmp/important"), "dangerous");
    assert.equal(classifyShellRisk("git reset --hard"), "dangerous");
    assert.equal(classifyShellRisk("git push --force origin main"), "dangerous");
    assert.equal(classifyShellRisk("sudo rm -rf /"), "dangerous");
});

test("classifyShellRisk keeps compound commands safe only when every segment is safe", () => {
    assert.equal(classifyShellRisk("git status && npm run build"), "safe");
    assert.equal(classifyShellRisk("git status && rm -rf /tmp/x"), "dangerous");
});

test("classifyShellRisk labels unclassified commands risky", () => {
    assert.equal(classifyShellRisk("pnpm exec mystery-cli"), "risky");
    assert.equal(classifyShellRisk(""), "risky");
});

test("classifyShellRisk keeps global installs behind the approval gate", () => {
    assert.equal(classifyShellRisk("pnpm add -g some-package"), "risky");
    assert.equal(classifyShellRisk("npm install --global some-package"), "risky");
});
