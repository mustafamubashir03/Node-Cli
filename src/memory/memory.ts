import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "node:fs";
import { join, resolve, basename, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";

export type MemoryScope = "global" | "project";

export type MemoryEntry = {
    id: string;
    scope: MemoryScope;
    content: string;
    source: string;
    created: string;
    updated: string;
};

export function getNodeCliHome(): string {
    return process.env.NODE_CLI_HOME ? resolve(process.env.NODE_CLI_HOME) : join(homedir(), ".node-cli");
}

export function getGlobalMemoryDir(): string {
    return join(getNodeCliHome(), "memory", "global");
}

export function findProjectRoot(start = process.cwd()): string {
    let current = resolve(start);
    while (true) {
        if (
            existsSync(join(current, ".git")) ||
            existsSync(join(current, "package.json")) ||
            existsSync(join(current, ".node-cli"))
        ) {
            return current;
        }
        const parent = dirname(current);
        if (parent === current) break;
        current = parent;
    }
    return resolve(start);
}

export function getProjectMemoryDir(root = findProjectRoot()): string {
    return join(root, ".node-cli", "memory");
}

function memoryDir(scope: MemoryScope, root?: string): string {
    return scope === "global" ? getGlobalMemoryDir() : getProjectMemoryDir(root);
}

function ensureDir(dir: string): void {
    mkdirSync(dir, { recursive: true });
}

function safePath(root: string, id: string): string {
    const cleaned = id.replace(/[^a-zA-Z0-9._-]/g, "");
    if (!cleaned || cleaned !== id) {
        throw new Error("Invalid memory id.");
    }
    const full = resolve(root, `${cleaned}.md`);
    if (!full.startsWith(resolve(root) + (process.platform === "win32" ? "\\" : "/"))) {
        throw new Error("Path traversal detected.");
    }
    return full;
}

function parseEntry(raw: string, fallbackId: string): MemoryEntry | null {
    if (!raw.startsWith("---\n")) return null;
    const end = raw.indexOf("\n---", 4);
    if (end === -1) return null;
    const fmRaw = raw.slice(4, end);
    const body = raw.slice(end + 4).replace(/^\n/, "").trim();
    const fm: Record<string, string> = {};
    for (const line of fmRaw.split("\n")) {
        const idx = line.indexOf(":");
        if (idx === -1) continue;
        fm[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
    if (!fm.id || !fm.scope) return null;
    return {
        id: fm.id,
        scope: fm.scope as MemoryScope,
        content: body,
        source: fm.source || "unknown",
        created: fm.created || "",
        updated: fm.updated || "",
    };
}

function serializeEntry(entry: MemoryEntry): string {
    return [
        "---",
        `id: ${entry.id}`,
        `scope: ${entry.scope}`,
        `source: ${entry.source}`,
        `created: ${entry.created}`,
        `updated: ${entry.updated}`,
        "---",
        "",
        entry.content,
        "",
    ].join("\n");
}

export function listMemories(scope?: MemoryScope, root?: string): MemoryEntry[] {
    const scopes: MemoryScope[] = scope ? [scope] : ["global", "project"];
    const entries: MemoryEntry[] = [];
    for (const s of scopes) {
        const dir = memoryDir(s, root);
        if (!existsSync(dir)) continue;
        let files: string[] = [];
        try {
            files = readdirSync(dir).filter((f) => f.endsWith(".md"));
        } catch {
            continue;
        }
        for (const file of files) {
            try {
                const raw = readFileSync(join(dir, file), "utf8");
                const entry = parseEntry(raw, file.replace(/\.md$/, ""));
                if (entry) entries.push(entry);
            } catch {
                // Skip unreadable/malformed files.
            }
        }
    }
    return entries;
}

export function searchMemories(query: string, scope?: MemoryScope, root?: string): MemoryEntry[] {
    const lower = query.toLowerCase();
    return listMemories(scope, root).filter((entry) => entry.content.toLowerCase().includes(lower) || entry.id.toLowerCase().includes(lower));
}

export function saveMemory(scope: MemoryScope, content: string, source = "user", root?: string): MemoryEntry {
    const dir = memoryDir(scope, root);
    ensureDir(dir);
    const now = new Date().toISOString();
    const entry: MemoryEntry = {
        id: randomUUID().replace(/-/g, "").slice(0, 12),
        scope,
        content: content.trim(),
        source,
        created: now,
        updated: now,
    };
    writeFileSync(safePath(dir, entry.id), serializeEntry(entry), "utf8");
    return entry;
}

export function editMemory(scope: MemoryScope, id: string, content: string, root?: string): MemoryEntry | null {
    return updateMemory(scope, id, content, root);
}

export function updateMemory(scope: MemoryScope, id: string, content: string, root?: string): MemoryEntry | null {
    const dir = memoryDir(scope, root);
    const path = safePath(dir, id);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, "utf8");
    const existing = parseEntry(raw, id);
    if (!existing) return null;
    const updated: MemoryEntry = {
        ...existing,
        content: content.trim(),
        updated: new Date().toISOString(),
    };
    writeFileSync(path, serializeEntry(updated), "utf8");
    return updated;
}

export function deleteMemory(scope: MemoryScope, id: string, root?: string): boolean {
    const dir = memoryDir(scope, root);
    const path = safePath(dir, id);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
}

export function loadMemoryContext(options: { cwd?: string; maxChars?: number; scope?: MemoryScope } = {}): string {
    const maxChars = options.maxChars ?? 1500;
    const root = findProjectRoot(options.cwd);
    const entries: MemoryEntry[] = [];
    if (!options.scope || options.scope === "global") {
        entries.push(...listMemories("global"));
    }
    if (!options.scope || options.scope === "project") {
        entries.push(...listMemories("project", root));
    }
    const lines: string[] = [];
    let used = 0;
    for (const entry of entries) {
        const line = `- [${entry.scope}] ${entry.content}`;
        if (used + line.length > maxChars) break;
        lines.push(line);
        used += line.length + 1;
    }
    return lines.join("\n");
}