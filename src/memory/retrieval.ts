import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { findProjectRoot, listMemories, searchMemories } from "./memory.js";
import { getSessionRoot, listSessions, readSessionConvo } from "./session-log.js";

export type RetrievedMemory = {
    source: string;
    type: "session" | "memory" | "decision" | "lesson";
    content: string;
    relevance: string;
    timestamp?: string;
};

export type RetrievalResult = {
    entries: RetrievedMemory[];
    totalChars: number;
    budgetChars: number;
    sources: string[];
};

const DEFAULT_BUDGET = 2000;

/**
 * Retrieves relevant memory entries for a given query.
 * Uses keyword matching against session conversations and memory entries.
 * Returns bounded results within the configured character budget.
 */
export function retrieveMemory(
    query: string,
    options: {
        budgetChars?: number;
        projectRoot?: string;
        includeSessions?: boolean;
        includeMemories?: boolean;
        maxSessions?: number;
    } = {},
): RetrievalResult {
    const budget = options.budgetChars ?? DEFAULT_BUDGET;
    const projectRoot = options.projectRoot ?? findProjectRoot();
    const includeSessions = options.includeSessions !== false;
    const includeMemories = options.includeMemories !== false;
    const maxSessions = options.maxSessions ?? 5;

    const entries: RetrievedMemory[] = [];
    const queryLower = query.toLowerCase();
    const queryTerms = queryLower.split(/\s+/).filter((t) => t.length >= 3);

    // 1. Search memory entries (durable project/global memory)
    if (includeMemories) {
        const memEntries = listMemories(undefined, projectRoot);
        for (const entry of memEntries) {
            const contentLower = entry.content.toLowerCase();
            const idLower = entry.id.toLowerCase();
            const matches = queryTerms.some((term) => contentLower.includes(term) || idLower.includes(term));
            if (matches) {
                entries.push({
                    source: `memory:${entry.id}`,
                    type: "memory",
                    content: entry.content.slice(0, 300),
                    relevance: `matched terms: ${queryTerms.filter((t) => contentLower.includes(t)).join(", ")}`,
                    timestamp: entry.updated,
                });
            }
        }
    }

    // 2. Search session conversations
    if (includeSessions) {
        const sessions = listSessions(projectRoot).slice(0, maxSessions);
        for (const session of sessions) {
            const convo = readSessionConvo(session.id, projectRoot);
            if (!convo) continue;
            const convoLower = convo.toLowerCase();
            const matches = queryTerms.some((term) => convoLower.includes(term));
            if (matches) {
                // Extract relevant sections (user messages and assistant summaries)
                const relevantLines = convo.split("\n").filter((line) => {
                    const lineLower = line.toLowerCase();
                    return queryTerms.some((term) => lineLower.includes(term));
                });
                if (relevantLines.length > 0) {
                    const excerpt = relevantLines.slice(0, 10).join("\n").slice(0, 500);
                    entries.push({
                        source: `session:${session.id}`,
                        type: "session",
                        content: excerpt,
                        relevance: `matched terms: ${queryTerms.filter((t) => convoLower.includes(t)).join(", ")}`,
                        timestamp: session.startedAt,
                    });
                }
            }
        }
    }

    // 3. Bound by budget
    const selected: RetrievedMemory[] = [];
    let used = 0;
    for (const entry of entries) {
        const entrySize = entry.content.length + entry.source.length + 20;
        if (used + entrySize > budget && selected.length > 0) break;
        selected.push(entry);
        used += entrySize;
    }

    return {
        entries: selected,
        totalChars: used,
        budgetChars: budget,
        sources: selected.map((e) => e.source),
    };
}

/**
 * Formats retrieved memory into a context string for injection into model prompts.
 */
export function formatMemoryContext(result: RetrievalResult): string {
    if (result.entries.length === 0) return "";
    const lines: string[] = ["## Retrieved memory (from previous sessions)"];
    for (const entry of result.entries) {
        lines.push(`### ${entry.source} (${entry.type})`);
        lines.push(entry.content);
        lines.push("");
    }
    return lines.join("\n");
}

/**
 * Records which memory sources were retrieved and injected.
 */
export function memoryRetrievalSummary(result: RetrievalResult): string {
    if (result.entries.length === 0) return "No relevant memory found.";
    return `Retrieved ${result.entries.length} memory entries (${result.totalChars}/${result.budgetChars} chars): ${result.sources.join(", ")}`;
}