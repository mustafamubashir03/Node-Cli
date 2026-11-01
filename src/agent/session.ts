import { query, type Query, type SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { buildInteractiveSdkOptions } from "./sdk-options.js";
import { InputQueue } from "./input-queue.js";
import { setActiveMode } from "./active-mode.js";
import { MODES, toPermissionMode, type Mode } from "./modes.js";

export type AgentSession = {
    query: Query;
    inputQueue: InputQueue;
    mode: Mode;
    stream: AsyncIterator<SDKMessage>;
    toolsAtStart: readonly string[];
    sessionId?: string;
    sessionSkills: string[];
};

export type ModeSwitch = {
    mode: Mode;
    restarted: boolean;
    resumedHistory: boolean;
};

export function createSession(mode: Mode, sessionSkills: string[] = []): AgentSession {
    setActiveMode(mode);

    const inputQueue = new InputQueue();
    const sdkQuery = query({
        prompt: inputQueue.generator(),
        options: buildInteractiveSdkOptions(mode, sessionSkills),
    });

    return {
        query: sdkQuery,
        inputQueue,
        mode,
        stream: sdkQuery[Symbol.asyncIterator](),
        toolsAtStart: MODES[mode].tools,
        sessionSkills,
    };
}

export function needsRecreation(session: AgentSession, targetMode: Mode): boolean {
    return MODES[targetMode].tools.some((tool) => !session.toolsAtStart.includes(tool));
}

export async function switchMode(session: AgentSession, mode: Mode): Promise<ModeSwitch> {
    if (needsRecreation(session, mode)) {
        const resumedHistory = Boolean(session.sessionId);
        await recreateSession(session, mode);
        return { mode, restarted: true, resumedHistory };
    }

    await session.query.setPermissionMode(toPermissionMode(mode));
    session.mode = mode;
    setActiveMode(mode);
    return { mode, restarted: false, resumedHistory: true };
}

export async function switchModel(session: AgentSession, modelId: string): Promise<void> {
    process.env.AGENT_MODEL = modelId;
    // Models don't share conversation history on OpenRouter, so start fresh.
    session.sessionId = undefined;
    await recreateSession(session, session.mode);
}

/**
 * Applies an enable/disable change to the live session. The system prompt and
 * the UseSkill MCP server are built at query creation time, so the session has
 * to be recreated; conversation history is resumed when a session id exists.
 * Returns true when a restart was needed.
 */
export async function refreshSessionSkills(
    session: AgentSession,
    skills: string[],
): Promise<boolean> {
    const unchanged =
        skills.length === session.sessionSkills.length &&
        skills.every((skill, index) => skill === session.sessionSkills[index]);
    if (unchanged) return false;

    session.sessionSkills = [...skills];
    await recreateSession(session, session.mode);
    return true;
}

export async function closeSession(session: AgentSession): Promise<void> {
    session.inputQueue.close();
    await quietly(() => session.query.interrupt());
    await quietly(() => session.query.return());
}

async function recreateSession(session: AgentSession, mode: Mode): Promise<void> {
    const previousQuery = session.query;
    const resumeSessionId = session.sessionId;

    const returned = await quietly(() => previousQuery.return());
    if (!returned) {
        await quietly(() => previousQuery.close());
    }

    const sdkQuery = query({
        prompt: session.inputQueue.generator(),
        options: buildInteractiveSdkOptions(mode, session.sessionSkills, resumeSessionId),
    });

    session.query = sdkQuery;
    session.stream = sdkQuery[Symbol.asyncIterator]();
    session.mode = mode;
    session.toolsAtStart = MODES[mode].tools;
    setActiveMode(mode);
}

async function quietly(action: () => unknown): Promise<boolean> {
    try {
        await action();
        return true;
    } catch {
        return false;
    }
}