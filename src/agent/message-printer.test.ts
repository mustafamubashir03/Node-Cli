import { test } from "node:test";
import assert from "node:assert/strict";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { printMessage } from "./message-printer.js";
import { pauseOutput, resumeOutput } from "../ui/output-buffer.js";

function captureOutput() {
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

const toolResultMessage = (content: string, isError?: boolean): SDKMessage =>
    ({
        type: "user",
        parent_tool_use_id: null,
        message: { role: "user", content: [{ type: "tool_result", content, is_error: isError }] },
    }) as unknown as SDKMessage;

const toolCallMessage = (name: string, input: unknown): SDKMessage =>
    ({
        type: "assistant",
        message: { role: "assistant", content: [{ type: "tool_use", name, input }] },
    }) as unknown as SDKMessage;

test("a tool result is shown even though parent_tool_use_id is null", () => {
    const output = captureOutput();
    try {
        printMessage(toolResultMessage("File created successfully at G:\\node-cli\\todo\\index.html"));
        assert.match(output.text(), /File created successfully/, output.text());
    } finally {
        output.restore();
    }
});

test("a failed tool call is reported rather than silently dropped", () => {
    const output = captureOutput();
    try {
        printMessage(toolResultMessage("ENOENT: no such file or directory", true));
        const text = output.text();
        assert.match(text, /Tool failed/, text);
        assert.match(text, /ENOENT/, text);
    } finally {
        output.restore();
    }
});

test("a tool result is not dumped in full", () => {
    const output = captureOutput();
    try {
        printMessage(toolResultMessage("x".repeat(5000)));
        assert.ok(output.text().length < 800, `output was ${output.text().length} chars`);
    } finally {
        output.restore();
    }
});

test("a tool call is printed once, with its most useful argument", () => {
    const output = captureOutput();
    try {
        printMessage(toolCallMessage("Write", { file_path: "todo/index.html", content: "x".repeat(500) }));
        const text = output.text();
        assert.match(text, /→ Write: todo\/index\.html/, text);
        assert.equal(text.split("Write").length - 1, 1, `Write printed ${text.split("Write").length - 1} times`);
        assert.ok(!text.includes("xxxx"), "the file body must not be echoed back");
    } finally {
        output.restore();
    }
});

test("the session line names the model and the session id", () => {
    const output = captureOutput();
    try {
        printMessage({
            type: "system",
            subtype: "init",
            model: "poolside/laguna-s-2.1:free",
            session_id: "session-123",
        } as unknown as SDKMessage);
        const text = output.text();
        assert.match(text, /Session started/, text);
        assert.match(text, /session-123/, text);
    } finally {
        output.restore();
    }
});

test("a successful turn ends with the turn count and the cost", () => {
    const output = captureOutput();
    try {
        printMessage({
            type: "result",
            subtype: "success",
            result: "All done",
            num_turns: 3,
            total_cost_usd: 0.5,
        } as unknown as SDKMessage);
        const text = output.text();
        assert.match(text, /All done/, text);
        assert.match(text, /3 turns/, text);
        assert.match(text, /0\.500000/, text);
    } finally {
        output.restore();
    }
});

test("tool notifications are held while a prompt is waiting and flushed after", () => {
    const output = captureOutput();
    try {
        pauseOutput();
        printMessage(toolCallMessage("Write", { file_path: "b.txt" }));

        assert.equal(output.text().includes("Write"), false, "must not print over the prompt");
        resumeOutput();
        assert.match(output.text(), /Write/, "buffered notification is flushed after the answer");
    } finally {
        resumeOutput();
        output.restore();
    }
});