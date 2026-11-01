import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSdkOptions, buildInteractiveSdkOptions } from "./sdk-options.js";

process.env.OPENROUTER_API_KEY ??= "test-key";

test("buildSdkOptions has empty skills and settingSources", () => {
    const opts = buildSdkOptions("agent");
    assert.deepEqual(opts.skills, []);
    assert.deepEqual(opts.settingSources, []);
});

test("buildInteractiveSdkOptions registers skill MCP server", () => {
    const opts = buildInteractiveSdkOptions("agent", ["accessibility"]);
    assert.ok(opts.mcpServers && "node-cli" in opts.mcpServers);
});

test("custom skill ids are not forwarded as SDK skill names", () => {
    // The SDK 'skills' option preloads Claude Code skills (pdf, docx, ...).
    // Local catalog ids are served by our MCP server instead.
    const opts = buildSdkOptions("agent", ["accessibility", "frontend-design"]);
    assert.deepEqual(opts.skills, []);
});