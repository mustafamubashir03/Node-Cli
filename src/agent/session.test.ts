import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRecreation, type AgentSession } from "./session.js";
import { MODES, type Mode } from "./modes.js";

function fakeSession(mode: Mode, sessionId?: string): AgentSession {
    return {
        query: null as never,
        inputQueue: null as never,
        mode,
        stream: null as never,
        toolsAtStart: MODES[mode].tools,
        sessionId,
    };
}

test("needsRecreation follows the tool-surface relationship", () => {
    const cases: [Mode, Mode, boolean][] = [
        ["ask", "agent", true],
        ["plan", "agent", true],
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
    const session = fakeSession("ask");
    assert.equal(needsRecreation(session, "agent"), true);

    session.mode = "agent";
    session.toolsAtStart = MODES.agent.tools;
    for (let round = 0; round < 5; round++) {
        assert.equal(needsRecreation(session, "ask"), false, `agent->ask #${round}`);
        session.mode = "ask";
        assert.equal(needsRecreation(session, "agent"), false, `ask->agent #${round}`);
        assert.equal(needsRecreation(session, "plan"), false, `ask->plan #${round}`);
        session.mode = "agent";
    }
});