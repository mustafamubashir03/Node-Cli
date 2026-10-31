import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSdkOptions } from "./sdk-options.js";
import { ALL_MODES, MODES, toPermissionMode } from "./modes.js";

process.env.OPENROUTER_API_KEY ??= "test-key";

test("every mode gets the correct tools and permission mode", () => {
    for (const mode of ALL_MODES) {
        const options = buildSdkOptions(mode);
        assert.deepEqual([...options.tools].sort(), [...MODES[mode].tools].sort(), mode);
        assert.equal(options.permissionMode, toPermissionMode(mode), mode);
        assert.equal(options.maxTurns, MODES[mode].maxTurns, mode);
        assert.equal(options.allowedTools, undefined, mode);
    }
});

test("agent is a superset of ask and plan and holds the write tools", () => {
    const agentTools = MODES.agent.tools;
    for (const mode of ["ask", "plan"] as const) {
        for (const tool of MODES[mode].tools) {
            assert.ok(agentTools.includes(tool), `agent missing ${tool} required by ${mode}`);
        }
    }
    for (const tool of ["Edit", "Write", "Bash"]) {
        assert.ok(agentTools.includes(tool), `agent missing ${tool}`);
    }
});

test("ask and plan stay read-only", () => {
    for (const mode of ["ask", "plan"] as const) {
        const options = buildSdkOptions(mode);
        assert.equal(options.permissionMode, mode === "plan" ? "plan" : "dontAsk", mode);
        assert.equal(options.maxTurns, 6, mode);
        for (const tool of ["Edit", "Write", "Bash"]) {
            assert.equal(MODES[mode].tools.includes(tool), false, `${mode} must not have ${tool}`);
        }
    }
});

test("agent mode auto-accepts routine edits via the SDK permission mode", () => {
    assert.equal(buildSdkOptions("agent").permissionMode, "acceptEdits");
    assert.equal(MODES.agent.permissionMode, "acceptEdits");
});

test("strict mode keeps manual approval for edits", () => {
    assert.equal(buildSdkOptions("strict").permissionMode, "default");
    assert.equal(MODES.strict.permissionMode, "default");
    assert.equal(MODES.strict.strict, true);
});

test("the SDK is never told to load tools from disk settings", () => {
    const options = buildSdkOptions("agent");
    assert.deepEqual(options.settingSources, []);
    assert.deepEqual(options.skills, []);
});