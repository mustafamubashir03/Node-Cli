import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRecreation, type AgentSession } from "./create-session.js";
import { buildModeOptions, MODES, CliModeToPermissionMode, type Climode } from "./modes.js";

/**
 * Configuration only - not proof that the native subprocess received the tools.
 */
function fakeSession(mode: Climode, sessionId?: string): AgentSession {
    return {
        query: null as any,
        inputQueue: null as any,
        mode,
        stream: null as any,
        initialTools: MODES[mode].tools as readonly string[],
        sessionId,
    };
}

test("needsRecreation follows the tool-surface relationship", () => {
    const cases: [Climode, Climode, boolean][] = [
        // widening - the model was never offered Write/Edit/Bash
        ["ask", "agent", true],
        ["plan", "agent", true],
        // narrowing and same-mode reuse the live query
        ["agent", "ask", false],
        ["agent", "plan", false],
        ["ask", "plan", false],
        ["plan", "ask", false],
        ["agent", "agent", false],
        ["ask", "ask", false],
        ["plan", "plan", false],
    ];
    for (const [from, to, expected] of cases) {
        assert.equal(needsRecreation(fakeSession(from), to), expected, `${from} -> ${to}`);
    }
});

test("only the first widening needs recreation; later ones reuse the live query", () => {
    const s = fakeSession("ask");
    assert.equal(needsRecreation(s, "agent"), true);

    // After recreation the session keeps the wider agent tool surface, so every
    // later transition reuses the same query.
    s.mode = "agent";
    s.initialTools = MODES.agent.tools as readonly string[];
    for (let i = 0; i < 5; i++) {
        assert.equal(needsRecreation(s, "ask"), false, `agent->ask #${i}`);
        s.mode = "ask";
        assert.equal(needsRecreation(s, "agent"), false, `ask->agent #${i}`);
        assert.equal(needsRecreation(s, "plan"), false, `ask->plan #${i}`);
        s.mode = "agent";
    }
});

test("every mode gets the correct tools and permission mode", () => {
    for (const m of ["agent", "ask", "plan"] as const) {
        const o: any = buildModeOptions(m);
        assert.deepEqual([...o.tools].sort(), [...MODES[m].tools].sort(), m);
        assert.equal(o.permissionMode, CliModeToPermissionMode(m), m);
        assert.equal(o.allowedTools, undefined, m);
    }
});

test("agent is a superset of ask/plan and holds the write tools", () => {
    const agent = buildModeOptions("agent").tools as readonly string[];
    for (const m of ["ask", "plan"] as const) {
        for (const tool of buildModeOptions(m).tools as readonly string[]) {
            assert.ok(agent.includes(tool as never), `agent missing ${tool} required by ${m}`);
        }
    }
    for (const t of ["Edit", "Write", "Bash"]) {
        assert.ok(agent.includes(t as never), `agent missing ${t}`);
    }
});