import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { findProjectRoot, getNodeCliHome } from "./memory.js";
import { randomUUID } from "node:crypto";

export type SessionLogEntry = {
    id: string;
    role: "user" | "assistant" | "system" | "tool";
    timestamp: string;
    content: string;
    toolCallId?: string;
    toolName?: string;
};

export type SessionInfo = {
    id: string;
    startedAt: string;
    projectRoot: string;
    turnCount: number;
    lastActivity: string;
};

const SESSIONS_DIR = "sessions";

export function getSessionRoot(projectRoot?: string): string {
    const root = projectRoot ?? findProjectRoot();
    return join(root, ".node-cli", SESSIONS_DIR);
}

export function createSessionId(): string {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    return `session-${stamp}-${randomUUID().slice(0, 6)}`;
}

export function ensureSessionDir(sessionId: string, projectRoot?: string): string {
    const dir = join(getSessionRoot(projectRoot), sessionId);
    if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
    }
    return dir;
}

export function getSessionDir(sessionId: string, projectRoot?: string): string {
    return join(getSessionRoot(projectRoot), sessionId);
}

export function appendSessionEntry(sessionId: string, entry: SessionLogEntry, projectRoot?: string): void {
    const dir = ensureSessionDir(sessionId, projectRoot);
    const convoPath = join(dir, "convo.md");
    const line = formatEntry(entry);
    appendFileSync(convoPath, line + "\n", "utf8");
}

export function writeSessionSummary(sessionId: string, summary: string, projectRoot?: string): void {
    const dir = ensureSessionDir(sessionId, projectRoot);
    const summaryPath = join(dir, "summary.md");
    writeFileSync(summaryPath, summary, "utf8");
}

export function readSessionSummary(sessionId: string, projectRoot?: string): string | null {
    const dir = getSessionDir(sessionId, projectRoot);
    const summaryPath = join(dir, "summary.md");
    if (!existsSync(summaryPath)) return null;
    try {
        return readFileSync(summaryPath, "utf8");
    } catch {
        return null;
    }
}

export function readSessionConvo(sessionId: string, projectRoot?: string): string | null {
    const dir = getSessionDir(sessionId, projectRoot);
    const convoPath = join(dir, "convo.md");
    if (!existsSync(convoPath)) return null;
    try {
        return readFileSync(convoPath, "utf8");
    } catch {
        return null;
    }
}

export function listSessions(projectRoot?: string): SessionInfo[] {
    const root = getSessionRoot(projectRoot);
    if (!existsSync(root)) return [];
    const sessions: SessionInfo[] = [];
    try {
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const dir = join(root, entry.name);
            const convoPath = join(dir, "convo.md");
            if (!existsSync(convoPath)) continue;
            const content = readFileSync(convoPath, "utf8");
            const lines = content.split("\n");
            const firstLine = lines.find((l) => l.startsWith("# Session:")) || "";
            const startedAt = firstLine.replace("# Session:", "").trim() || "";
            const turnCount = (content.match(/^## Turn /gm) || []).length;
            const lastLine = lines.filter((l) => l.trim()).pop() || "";
            sessions.push({
                id: entry.name,
                startedAt,
                projectRoot: projectRoot ?? findProjectRoot(),
                turnCount,
                lastActivity: lastLine.slice(0, 80),
            });
        }
    } catch {
        // ignore
    }
    return sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

export function getLatestSession(projectRoot?: string): string | null {
    const sessions = listSessions(projectRoot);
    return sessions.length > 0 ? sessions[0].id : null;
}

function formatEntry(entry: SessionLogEntry): string {
    const header = `### [${entry.timestamp}] ${entry.role.toUpperCase()}${entry.toolName ? ` (${entry.toolName})` : ""}`;
    const meta = entry.toolCallId ? `<!-- id: ${entry.toolCallId} -->` : "";
    return `${header}\n${meta}\n${entry.content}\n`;
}

export function initSessionLog(sessionId: string, projectRoot?: string): void {
    const dir = ensureSessionDir(sessionId, projectRoot);
    const convoPath = join(dir, "convo.md");
    if (!existsSync(convoPath)) {
        const header = `# Session: ${new Date().toISOString()}\n\nSession ID: ${sessionId}\nProject: ${projectRoot ?? findProjectRoot()}\n\n---\n\n`;
        writeFileSync(convoPath, header, "utf8");
    }
}

export function appendTurnHeader(sessionId: string, turnNumber: number, projectRoot?: string): void {
    const dir = ensureSessionDir(sessionId, projectRoot);
    const convoPath = join(dir, "convo.md");
    appendFileSync(convoPath, `\n## Turn ${turnNumber} — ${new Date().toISOString()}\n\n`, "utf8");
}