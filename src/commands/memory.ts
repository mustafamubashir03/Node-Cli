import { existsSync } from "node:fs";
import { confirm, input } from "@inquirer/prompts";
import { findProjectRoot, listMemories, searchMemories, saveMemory, deleteMemory, updateMemory, getGlobalMemoryDir, getProjectMemoryDir, loadMemoryContext } from "../memory/memory.js";
import { retrieveMemory, formatMemoryContext, memoryRetrievalSummary } from "../memory/retrieval.js";
import { listSessions, readSessionSummary, readSessionConvo, getLatestSession } from "../memory/session-log.js";
import { printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";

export async function runMemoryCommand(args: string): Promise<void> {
    const parts = args.trim().split(/\s+/).filter(Boolean);
    const sub = parts[0]?.toLowerCase() || "sources";

    if (sub === "sources") {
        const root = findProjectRoot();
        printNotice(`Global memory: ${getGlobalMemoryDir()}`);
        printNotice(`Project root: ${root}`);
        printNotice(`Project memory: ${getProjectMemoryDir(root)}`);
        return;
    }

    if (sub === "list") {
        const scope = parts[1] === "global" || parts[1] === "project" ? (parts[1] as "global" | "project") : undefined;
        const entries = listMemories(scope);
        if (entries.length === 0) {
            printNotice("No memories stored.");
            return;
        }
        for (const entry of entries) {
            printNotice(`${entry.id} [${entry.scope}] (${entry.source}): ${entry.content}`);
        }
        return;
    }

    if (sub === "search") {
        const query = parts.slice(1).join(" ");
        if (!query) {
            printFailure("Usage: /memory search <query>");
            return;
        }
        const results = searchMemories(query);
        if (results.length === 0) {
            printNotice("No matching memories.");
            return;
        }
        for (const entry of results) {
            printNotice(`${entry.id} [${entry.scope}]: ${entry.content}`);
        }
        return;
    }

    if (sub === "save") {
        let scope: "global" | "project" = "project";
        let text = parts.slice(1).join(" ");
        if (text.startsWith("global:")) {
            scope = "global";
            text = text.slice("global:".length).trim();
        } else if (text.startsWith("project:")) {
            scope = "project";
            text = text.slice("project:".length).trim();
        }
        if (!text) {
            printFailure("Usage: /memory save [global:|project:] <text>");
            return;
        }
        const root = findProjectRoot();
        const entry = saveMemory(scope, text, "user", scope === "project" ? root : undefined);
        printSuccess(`Saved memory ${entry.id} to ${scope} scope.`);
        return;
    }

    if (sub === "edit") {
        const id = parts[1];
        if (!id) {
            printFailure("Usage: /memory edit <id>");
            return;
        }
        const root = findProjectRoot();
        const all = [...listMemories("global"), ...listMemories("project", root)];
        const entry = all.find((e) => e.id === id);
        if (!entry) {
            printFailure(`Memory ${id} not found.`);
            return;
        }
        printNotice(`Scope: ${entry.scope}`);
        printNotice(`Current: ${entry.content}`);
        try {
            const next = await input({ message: "New content", default: entry.content });
            const approved = await confirm({ message: "Save change?", default: true });
            if (!approved) {
                printHint("Edit cancelled.");
                return;
            }
            const updated = updateMemory(entry.scope, id, next, entry.scope === "project" ? root : undefined);
            if (updated) {
                printSuccess(`Updated memory ${id}.`);
            } else {
                printFailure(`Memory ${id} not found.`);
            }
        } catch {
            printHint("Edit cancelled.");
        }
        return;
    }

    if (sub === "delete") {
        const id = parts[1];
        if (!id) {
            printFailure("Usage: /memory delete <id>");
            return;
        }
        const root = findProjectRoot();
        const deletedGlobal = deleteMemory("global", id);
        const deletedProject = deleteMemory("project", id, root);
        if (deletedGlobal || deletedProject) {
            printSuccess(`Deleted memory ${id}.`);
        } else {
            printFailure(`Memory ${id} not found.`);
        }
        return;
    }

    if (sub === "context") {
        const context = loadMemoryContext({ cwd: process.cwd(), maxChars: 2000 });
        if (!context) {
            printNotice("No memory context available.");
        } else {
            printNotice(context);
        }
        return;
    }

    if (sub === "sessions") {
        const root = findProjectRoot();
        const sessions = listSessions(root);
        if (sessions.length === 0) {
            printNotice("No sessions recorded.");
            return;
        }
        for (const s of sessions.slice(0, 10)) {
            printNotice(`${s.id} — turns: ${s.turnCount}, started: ${s.startedAt}`);
        }
        if (sessions.length > 10) {
            printHint(`${sessions.length - 10} more sessions not shown.`);
        }
        return;
    }

    if (sub === "session") {
        const id = parts[1] || getLatestSession(findProjectRoot());
        if (!id) {
            printNotice("No sessions recorded.");
            return;
        }
        const convo = readSessionConvo(id);
        if (!convo) {
            printFailure(`Session ${id} not found.`);
            return;
        }
        const lines = convo.split("\\n");
        printNotice(`Session ${id} (${lines.length} lines):`);
        // Print last 20 lines as summary
        const tail = lines.slice(-20).join("\\n");
        printNotice(tail);
        return;
    }

    if (sub === "retrieve") {
        const query = parts.slice(1).join(" ");
        if (!query) {
            printFailure("Usage: /memory retrieve <query>");
            return;
        }
        const root = findProjectRoot();
        const result = retrieveMemory(query, { projectRoot: root });
        if (result.entries.length === 0) {
            printNotice("No relevant memory found for this query.");
            return;
        }
        printNotice(memoryRetrievalSummary(result));
        printNotice(formatMemoryContext(result));
        return;
    }

    printHint("Usage: /memory [sources|list [global|project]|search <query>|save ...|edit <id>|delete <id>|context|sessions|session [id]|retrieve <query>]");
}