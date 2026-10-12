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
    /** The `tools` this query was initialised with. Fixed for the query's lifetime. */
    initialTools: readonly string[];
    /** From the SDK `system`/`init` message; used to resume history on recreation. */
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
    // Seeded before the first query so the PreToolUse hook enforces the startup
    // mode from the very first tool call.
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

/**
 * A query's tool list is fixed at init and the SDK has no setTools, so widening
 * ask/plan -> agent needs a new query. Narrowing reuses the live one: the
 * PreToolUse hook and canUseTool deny the tools the mode doesn't allow.
 */
export function needsRecreation(session: AgentSession, mode: Climode): boolean {
    const target = MODES[mode].tools as readonly string[];
    return target.some((tool) => !session.initialTools.includes(tool));
}

/**
 * Replace the query so a widened mode gets its tools, resuming the same
 * transcript when a session id is known.
 *
 * The old query is torn down first: its InputQueue generator is actively pulling
 * from the shared queue, so leaving it alive would let two subprocesses race for
 * the next user message.
 */
export async function recreateSession(session: AgentSession, mode: Climode): Promise<void> {
    const previous = session.query;
    const resume = session.sessionId;

    try {
        await previous.return();
    } catch {
        // Release the stream even if the subprocess is already gone.
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