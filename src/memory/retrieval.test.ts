import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { retrieveMemory, formatMemoryContext, memoryRetrievalSummary } from "./retrieval.js";
import { saveMemory } from "./memory.js";
import { initSessionLog, appendSessionEntry } from "./session-log.js";

test("retrieveMemory returns empty when no data exists", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-test-"));
    const result = retrieveMemory("coffee shop", { projectRoot: dir, budgetChars: 1000 });
    assert.equal(result.entries.length, 0);
    assert.equal(result.totalChars, 0);
    assert.ok(result.budgetChars > 0);
    rmSync(dir, { recursive: true, force: true });
});

test("retrieveMemory finds relevant memory entries", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-test-"));
    mkdirSync(join(dir, ".node-cli", "memory"), { recursive: true });
    saveMemory("project", "The coffee shop uses dark theme with gold accents", "agent", dir);
    saveMemory("project", "Database uses PostgreSQL with RLS", "agent", dir);
    const result = retrieveMemory("coffee shop theme", { projectRoot: dir, budgetChars: 1000 });
    assert.ok(result.entries.length > 0);
    assert.ok(result.entries.some((e) => e.content.includes("coffee shop")));
    assert.ok(result.sources.some((s) => s.startsWith("memory:")));
    rmSync(dir, { recursive: true, force: true });
});

test("retrieveMemory finds relevant session conversations", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-test-"));
    const sessionId = "test-session-1";
    initSessionLog(sessionId, dir);
    appendSessionEntry(sessionId, {
        id: "user-1",
        role: "user",
        timestamp: new Date().toISOString(),
        content: "Build a coffee shop landing page with hero section",
    }, dir);
    appendSessionEntry(sessionId, {
        id: "assistant-1",
        role: "assistant",
        timestamp: new Date().toISOString(),
        content: "Created index.html with hero section and navigation",
    }, dir);
    const result = retrieveMemory("coffee shop hero", { projectRoot: dir, budgetChars: 1000 });
    assert.ok(result.entries.length > 0);
    assert.ok(result.entries.some((e) => e.source.startsWith("session:")));
    rmSync(dir, { recursive: true, force: true });
});

test("retrieveMemory respects budget", () => {
    const dir = mkdtempSync(join(tmpdir(), "mem-test-"));
    mkdirSync(join(dir, ".node-cli", "memory"), { recursive: true });
    for (let i = 0; i < 10; i++) {
        saveMemory("project", `Memory entry ${i} about coffee shop design patterns and layouts`, "agent", dir);
    }
    const result = retrieveMemory("coffee shop design", { projectRoot: dir, budgetChars: 200 });
    assert.ok(result.totalChars <= 200 || result.entries.length <= 1);
    rmSync(dir, { recursive: true, force: true });
});

test("formatMemoryContext produces readable output", () => {
    const result = {
        entries: [{ source: "memory:abc", type: "memory" as const, content: "test content", relevance: "matched", timestamp: "2024-01-01" }],
        totalChars: 20,
        budgetChars: 1000,
        sources: ["memory:abc"],
    };
    const formatted = formatMemoryContext(result);
    assert.match(formatted, /Retrieved memory/);
    assert.match(formatted, /test content/);
});

test("formatMemoryContext returns empty for no entries", () => {
    const result = { entries: [], totalChars: 0, budgetChars: 1000, sources: [] };
    const formatted = formatMemoryContext(result);
    assert.equal(formatted, "");
});

test("memoryRetrievalSummary reports count and sources", () => {
    const result = {
        entries: [{ source: "memory:abc", type: "memory" as const, content: "test", relevance: "matched" }],
        totalChars: 10,
        budgetChars: 1000,
        sources: ["memory:abc"],
    };
    const summary = memoryRetrievalSummary(result);
    assert.match(summary, /Retrieved 1 memory/);
    assert.match(summary, /memory:abc/);
});

test("memoryRetrievalSummary reports no memory found", () => {
    const result = { entries: [], totalChars: 0, budgetChars: 1000, sources: [] };
    const summary = memoryRetrievalSummary(result);
    assert.equal(summary, "No relevant memory found.");
});