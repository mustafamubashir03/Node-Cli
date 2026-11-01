import { test } from "node:test";
import assert from "node:assert/strict";
import { DeadlineExceededError, nextWithDeadline, settleWithin } from "./deadline.js";

function iteratorOf<T>(values: T[]): AsyncIterator<T> {
    let index = 0;
    return {
        async next() {
            if (index >= values.length) return { value: undefined, done: true } as IteratorResult<T>;
            return { value: values[index++], done: false } as IteratorResult<T>;
        },
    };
}

test("nextWithDeadline returns values before the deadline", async () => {
    const iterator = iteratorOf(["a", "b"]);
    const first = await nextWithDeadline(iterator, Date.now() + 1_000);
    const second = await nextWithDeadline(iterator, Date.now() + 1_000);
    assert.deepEqual(first, { value: "a", done: false });
    assert.deepEqual(second, { value: "b", done: false });
});

test("nextWithDeadline rejects when a wait outlives the deadline", async () => {
    let timedOut = false;
    const iterator: AsyncIterator<string> = {
        next: () => new Promise(() => undefined),
    };

    await assert.rejects(
        nextWithDeadline(iterator, Date.now() + 20, () => {
            timedOut = true;
        }),
        DeadlineExceededError,
    );
    assert.equal(timedOut, true);
});

test("nextWithDeadline rejects immediately when the deadline already passed", async () => {
    let timedOut = false;
    const iterator = iteratorOf(["late"]);

    await assert.rejects(
        nextWithDeadline(iterator, Date.now() - 1, () => {
            timedOut = true;
        }),
        DeadlineExceededError,
    );
    assert.equal(timedOut, true);
});

test("a chatty stream cannot extend the total deadline", async () => {
    const started = Date.now();
    const deadline = started + 40;
    let messages = 0;
    const iterator: AsyncIterator<number> = {
        async next() {
            messages += 1;
            return { value: messages, done: false };
        },
    };

    await assert.rejects(async () => {
        while (true) {
            await nextWithDeadline(iterator, deadline);
        }
    }, DeadlineExceededError);

    assert.ok(messages > 0);
    assert.ok(
        Date.now() - started < 1_000,
        `deadline was not enforced; elapsed ${Date.now() - started}ms`,
    );
});

test("settleWithin resolves when an action never settles", async () => {
    const started = Date.now();
    await settleWithin(new Promise(() => undefined), 15);
    assert.ok(Date.now() - started < 1_000);
});

test("settleWithin swallows rejection and handles a missing action", async () => {
    await settleWithin(Promise.reject(new Error("ignored")), 50);
    await settleWithin(undefined, 50);
});
