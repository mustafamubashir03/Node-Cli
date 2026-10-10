import { query, type Query } from "@anthropic-ai/claude-agent-sdk";
import { buildModeOptions, type Climode } from "./modes.ts";
import { InputQueue } from "./input-queue.ts";
import { createCanUseTool } from "./permissions.ts";

export type AgentSession = {
    query: Query;
    inputQueue: InputQueue;
    mode: Climode;
};

export function createSession(mode: Climode): AgentSession {
    const inputQueue = new InputQueue();
    const session: AgentSession = {
        query: null as any,
        inputQueue,
        mode
    };
    const options = buildModeOptions(mode);
    options.canUseTool = createCanUseTool(() => session.mode);
    session.query = query({
        prompt: inputQueue.generator(),
        options
    });
    return session;
}