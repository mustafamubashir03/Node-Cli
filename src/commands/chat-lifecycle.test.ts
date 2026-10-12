import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { drainUntilResult } from "./chat.js";

function createFakeQuery() {
    const pending: SDKMessage[] = [];
    let resolveNext: (() => void) | undefined;
    let closed = false;

    const stream = (async function* (): AsyncGenerator<SDKMessage> {
        try {
            for (;;) {
                if (pending.length === 0) {
                    await new Promise<void>((r) => {
                        resolveNext = r;
                    });
                }
                const next = pending.shift();
                if (next === undefined) return;
                yield next;
            }
        } finally {
            closed = true;
        }
    })();

    return {
        stream,
        emit(message: SDKMessage) {
            pending.push(message);
            resolveNext?.();
            resolveNext = undefined;
        },
        isClosed: () => closed,
        setPermissionMode() {
            return closed
                ? Promise.reject(new Error("Query closed before response received"))
                : Promise.resolve();
        },
    };
}

const msg = (type: string) => ({ type } as unknown as SDKMessage);

test("regression: `for await` + break tears down the session (the original defect)", async () => {
    const q = createFakeQuery();
    q.emit(msg("assistant"));
    q.emit(msg("result"));

    for await (const _ of { [Symbol.asyncIterator]: () => q.stream }) {
        if ((_ as SDKMessage).type === "result") break;
    }

    assert.equal(q.isClosed(), true, "break should have closed the session");
    await assert.rejects(
        () => q.setPermissionMode(),
        /Query closed before response received/,
        "this is the exact failure the user hit"
    );
});

test("drainUntilResult leaves the session open across turns", async () => {
    const q = createFakeQuery();
    const seen: string[] = [];

    q.emit(msg("assistant"));
    q.emit(msg("result"));
    await drainUntilResult(q.stream, (m) => seen.push(m.type));
    assert.deepEqual(seen, ["assistant", "result"]);
    assert.equal(q.isClosed(), false, "session must stay alive after a result");

    seen.length = 0;
    q.emit(msg("assistant"));
    q.emit(msg("result"));
    await drainUntilResult(q.stream, (m) => seen.push(m.type));
    assert.deepEqual(seen, ["assistant", "result"]);
    assert.equal(q.isClosed(), false);
    await q.setPermissionMode();
});

test("repeated mode switches keep setPermissionMode working", async () => {
    const q = createFakeQuery();

    for (const mode of ["agent", "ask", "plan", "agent", "plan", "ask"]) {
        q.emit(msg("assistant"));
        q.emit(msg("result"));
        await drainUntilResult(q.stream, () => {});
        await q.setPermissionMode();
        assert.equal(q.isClosed(), false, `session closed after switching to ${mode}`);
    }
});

test("drainUntilResult returns when the stream is done", async () => {
    const q = createFakeQuery();
    q.emit(msg("assistant"));
    await q.stream.next();
    await q.stream.return(undefined as never);
    assert.equal(q.isClosed(), true, "explicit return() closes, as expected");

    await drainUntilResult(q.stream, () => {});
});