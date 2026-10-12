import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { handleMessage, pauseOutput, resumeOutput } from "./message-handler.js";


function capture() {
    const lines: string[] = [];
    const original = process.stdout.write.bind(process.stdout);
    (process.stdout as any).write = (chunk: any) => {
        lines.push(String(chunk));
        return true;
    };
    return {
        text: () => lines.join("").replace(/\u001b\[[0-9;]*m/g, ""),
        restore: () => {
            (process.stdout as any).write = original;
        },
    };
}

const toolResult = (content: string, is_error?: boolean): SDKMessage =>
    ({
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: [{ type: "tool_result", content, is_error }] },
    }) as unknown as SDKMessage;

test("a tool result is shown even though parent_tool_use_id is null", () => {
    const io = capture();
    try {
        handleMessage(toolResult("File created successfully at G:\\node-cli\\todo\\index.html"));
        assert.match(io.text(), /File created successfully/, io.text());
    } finally {
        io.restore();
    }
});

test("a failed tool call is reported rather than silently dropped", () => {
    const io = capture();
    try {
        handleMessage(toolResult("ENOENT: no such file or directory", true));
        const out = io.text();
        assert.match(out, /Tool failed/, out);
        assert.match(out, /ENOENT/, out);
    } finally {
        io.restore();
    }
});

test("a tool result is not dumped in full", () => {
    const io = capture();
    try {
        handleMessage(toolResult("x".repeat(5000)));
        assert.ok(io.text().length < 800, `output was ${io.text().length} chars`);
    } finally {
        io.restore();
    }
});

test("tool notifications are held while a prompt is waiting and flushed after", () => {
    const io = capture();
    try {
        pauseOutput();
        handleMessage({
            type: "assistant",
            message: { role: "assistant", content: [{ type: "tool_use", name: "Write", input: { file_path: "b.txt" } }] },
        } as unknown as SDKMessage);

        assert.equal(io.text().includes("Write"), false, "must not print over the prompt");
        resumeOutput();
        assert.match(io.text(), /Write/, "buffered notification is flushed after the answer");
    } finally {
        resumeOutput();
        io.restore();
    }
});