import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { drainUntilResult } from "./turn.js";

function createFakeQuery() {
    const pending: SDKMessage[] = [];
    let resolveNext: (() => void) | undefined;
    let closed = false;

    const stream = (async function* (): AsyncGenerator<SDKMessage> {
        try {
            for (;;) {
                if (pending.length === 0) {
                    await new Promise<void>((resolve) => {
                        resolveNext = resolve;
                    });
                }
                const next = pending.shift();
                if (next === undefined) {
                    return;
                }
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

const messageOfType = (type: string) => ({ type }) as unknown as SDKMessage;

test("regression: `for await` + break tears down the session (the original defect)", async () => {
    const query = createFakeQuery();
    query.emit(messageOfType("assistant"));
    query.emit(messageOfType("result"));

    for await (const message of { [Symbol.asyncIterator]: () => query.stream }) {
        if ((message as SDKMessage).type === "result") {
            break;
        }
    }

    assert.equal(query.isClosed(), true, "break should have closed the session");
    await assert.rejects(
        () => query.setPermissionMode(),
        /Query closed before response received/,
        "this is the exact failure the user hit",
    );
});

test("drainUntilResult leaves the session open across turns", async () => {
    const query = createFakeQuery();
    const seen: string[] = [];

    query.emit(messageOfType("assistant"));
    query.emit(messageOfType("result"));
    await drainUntilResult(query.stream, (message) => seen.push(message.type));
    assert.deepEqual(seen, ["assistant", "result"]);
    assert.equal(query.isClosed(), false, "session must stay alive after a result");

    seen.length = 0;
    query.emit(messageOfType("assistant"));
    query.emit(messageOfType("result"));
    await drainUntilResult(query.stream, (message) => seen.push(message.type));
    assert.deepEqual(seen, ["assistant", "result"]);
    assert.equal(query.isClosed(), false);
    await query.setPermissionMode();
});

test("repeated mode switches keep setPermissionMode working", async () => {
    const query = createFakeQuery();

    for (const mode of ["agent", "ask", "plan", "agent", "plan", "ask"]) {
        query.emit(messageOfType("assistant"));
        query.emit(messageOfType("result"));
        await drainUntilResult(query.stream, () => {});
        await query.setPermissionMode();
        assert.equal(query.isClosed(), false, `session closed after switching to ${mode}`);
    }
});

test("drainUntilResult returns immediately when the stop guard fires", async () => {
    const query = createFakeQuery();
    const seen: string[] = [];

    query.emit(messageOfType("assistant"));
    query.emit(messageOfType("result"));

    await drainUntilResult(
        query.stream,
        (message) => seen.push(message.type),
        (message) => message.type === "assistant",
    );

    assert.deepEqual(seen, ["assistant"], "the result after the stop was not consumed");
    assert.equal(query.isClosed(), false, "stopping a turn must not close the session");
    await query.setPermissionMode();
});

test("drainUntilResult returns when the stream is done", async () => {
    const query = createFakeQuery();
    query.emit(messageOfType("assistant"));
    await query.stream.next();
    await query.stream.return(undefined as never);
    assert.equal(query.isClosed(), true, "explicit return() closes, as expected");

    await drainUntilResult(query.stream, () => {});
});