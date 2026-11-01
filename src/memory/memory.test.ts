import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { saveMemory, listMemories, searchMemories, deleteMemory, updateMemory, editMemory, findProjectRoot, loadMemoryContext, getProjectMemoryDir, getGlobalMemoryDir } from "./memory.js";

test("findProjectRoot detects package.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        const nested = join(dir, "src");
        mkdirSync(nested);
        assert.equal(findProjectRoot(nested), dir);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("save and list project memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        const entry = saveMemory("project", "use tabs", "user", dir);
        const entries = listMemories("project", dir);
        assert.equal(entries.length, 1);
        assert.equal(entries[0].id, entry.id);
        assert.equal(entries[0].content, "use tabs");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("global and project scopes are isolated", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        saveMemory("global", "global pref", "user");
        saveMemory("project", "project decision", "user", dir);
        const globalEntries = listMemories("global");
        const projectEntries = listMemories("project", dir);
        assert.ok(globalEntries.every((e) => e.scope === "global"));
        assert.ok(projectEntries.every((e) => e.scope === "project"));
        assert.equal(searchMemories("global pref", "project", dir).length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("search memories by keyword", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        saveMemory("project", "prefer TypeScript", "user", dir);
        const results = searchMemories("TypeScript", "project", dir);
        assert.equal(results.length, 1);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("delete memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        const entry = saveMemory("project", "temp", "user", dir);
        assert.equal(deleteMemory("project", entry.id, dir), true);
        assert.equal(listMemories("project", dir).length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("editMemory updates content", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        const entry = saveMemory("project", "old", "user", dir);
        const updated = editMemory("project", entry.id, "new", dir);
        assert.ok(updated);
        assert.equal(updated!.content, "new");
        assert.equal(updated!.scope, "project");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("update memory", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        const entry = saveMemory("project", "old", "user", dir);
        const updated = updateMemory("project", entry.id, "new", dir);
        assert.ok(updated);
        assert.equal(updated!.content, "new");
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("malformed files are skipped", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        const memDir = getProjectMemoryDir(dir);
        mkdirSync(memDir, { recursive: true });
        writeFileSync(join(memDir, "bad.md"), "not valid frontmatter", "utf8");
        assert.doesNotThrow(() => listMemories("project", dir));
        assert.equal(listMemories("project", dir).length, 0);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("path traversal protection", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        assert.throws(() => deleteMemory("project", "../secret", dir), /Invalid memory id/);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("context size limits", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    try {
        writeFileSync(join(dir, "package.json"), "{}");
        saveMemory("project", "a".repeat(500), "user", dir);
        const context = loadMemoryContext({ cwd: dir, maxChars: 50 });
        assert.ok(context.length <= 50);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

test("memory optional when unavailable", () => {
    const dir = mkdtempSync(join(tmpdir(), "proj-"));
    const context = loadMemoryContext({ cwd: dir, maxChars: 100 });
    assert.equal(typeof context, "string");
});