import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import {
    buildModeOptions,
    createModeGuardHook,
    MODES,
    setCurrentMode,
    type Climode,
} from "./modes.js";
import { InputQueue } from "./input-queue.js";
import { createCanUseTool } from "./permissions.js";

export type AgentSession = {
    query: Query;
    inputQueue: InputQueue;
    mode: Climode;
    stream: AsyncIterator<SDKMessage>;
    initialTools: readonly string[];
    sessionId?: string;
};

function buildOptions(mode: Climode, resume?: string) {
    const options = buildModeOptions(mode);
    if (resume) {
        options.resume = resume;
    }
    options.canUseTool = createCanUseTool();
    options.hooks = { PreToolUse: [{ hooks: [createModeGuardHook()] }] };
    return options;
}

export function createSession(mode: Climode): AgentSession {
    setCurrentMode(mode);

    const inputQueue = new InputQueue();
    const options = buildOptions(mode);
    const q = query({ prompt: inputQueue.generator(), options });

    return {
        query: q,
        inputQueue,
        mode,
        stream: q[Symbol.asyncIterator](),
        initialTools: MODES[mode].tools as readonly string[],
    };
}

export function needsRecreation(session: AgentSession, mode: Climode): boolean {
    const target = MODES[mode].tools as readonly string[];
    return target.some((tool) => !session.initialTools.includes(tool));
}

export async function recreateSession(session: AgentSession, mode: Climode): Promise<void> {
    const previous = session.query;
    const resume = session.sessionId;

    try {
        await previous.return();
    } catch {
        try {
            previous.close();
        } catch {}
    }

    setCurrentMode(mode);
    const options = buildOptions(mode, resume);
    const q = query({ prompt: session.inputQueue.generator(), options });

    session.query = q;
    session.stream = q[Symbol.asyncIterator]();
    session.mode = mode;
    session.initialTools = MODES[mode].tools as readonly string[];
}