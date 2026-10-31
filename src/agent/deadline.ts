export class DeadlineExceededError extends Error {
    constructor(message = "Deadline reached.") {
        super(message);
        this.name = "DeadlineExceededError";
    }
}

/**
 * Waits for the next iterator value but never past an absolute deadline.
 *
 * The deadline is checked before every wait and enforced with a timer around
 * that single wait, so a chatty stream cannot extend the total budget by
 * producing messages indefinitely. This is what the old per-message timeout
 * wrapper got wrong.
 */
export async function nextWithDeadline<T>(
    iterator: AsyncIterator<T>,
    deadline: number,
    onTimeout?: () => void,
): Promise<IteratorResult<T>> {
    const remaining = deadline - Date.now();
    if (remaining <= 0) {
        onTimeout?.();
        throw new DeadlineExceededError();
    }

    let timer: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            iterator.next(),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    onTimeout?.();
                    reject(new DeadlineExceededError());
                }, remaining);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** Settles an optional promise, ignoring its result and any error. */
export async function settleWithin(
    action: Promise<unknown> | undefined,
    timeoutMs: number,
): Promise<void> {
    if (!action) return;
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            action.catch(() => undefined),
            new Promise<void>((resolve) => {
                timer = setTimeout(resolve, timeoutMs);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
