import type { SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

export class InputQueue {
    private pending: SDKUserMessage[] = [];
    private waiting: ((message: SDKUserMessage | null) => void) | null = null;
    private closed = false;

    push(content: string): void {
        const message = toUserMessage(content);
        if (this.waiting) {
            const deliver = this.waiting;
            this.waiting = null;
            deliver(message);
            return;
        }
        this.pending.push(message);
    }

    close(): void {
        this.closed = true;
        this.waiting?.(null);
        this.waiting = null;
    }

    async *generator(): AsyncGenerator<SDKUserMessage> {
        while (!this.closed) {
            const message = await this.nextMessage();
            if (message === null) {
                return;
            }
            yield message;
        }
    }

    private nextMessage(): Promise<SDKUserMessage | null> {
        const queued = this.pending.shift();
        if (queued) {
            return Promise.resolve(queued);
        }
        if (this.closed) {
            return Promise.resolve(null);
        }
        return new Promise((resolve) => {
            this.waiting = resolve;
        });
    }
}

function toUserMessage(content: string): SDKUserMessage {
    return {
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
    };
}