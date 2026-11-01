import { test } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserQAResult } from "../ui/browser-qa.js";
import { parseQaTarget, qaPassed, screenshotPathFor } from "./qa.js";

function result(overrides: Partial<BrowserQAResult> = {}): BrowserQAResult {
    return {
        available: true,
        url: "http://localhost:3000/",
        ok: true,
        status: 200,
        title: "Fixture",
        consoleErrors: [],
        pageErrors: [],
        horizontalOverflow: false,
        screenshotPath: null,
        issues: [],
        ...overrides,
    };
}

test("accepts an explicit http URL", () => {
    const target = parseQaTarget("http://localhost:3000/landing?x=1");
    assert.equal(target.ok, true);
    if (target.ok) assert.equal(target.url, "http://localhost:3000/landing?x=1");
});

test("adds a scheme to a bare localhost address", () => {
    const target = parseQaTarget("localhost:5173");
    assert.equal(target.ok, true);
    if (target.ok) assert.equal(target.url, "http://localhost:5173/");
});

test("accepts https URLs", () => {
    const target = parseQaTarget("https://example.com");
    assert.equal(target.ok, true);
    if (target.ok) assert.equal(target.url, "https://example.com/");
});

test("rejects non-web schemes and empty input", () => {
    for (const input of ["", "   ", "file:///C:/secret.html", "javascript:alert(1)", "data:text/html,x"]) {
        const target = parseQaTarget(input);
        assert.equal(target.ok, false, input);
    }
});

test("rejects text that is not a URL", () => {
    const target = parseQaTarget("not a url");
    assert.equal(target.ok, false);
});

test("a page with no findings passes", () => {
    assert.equal(qaPassed(result()), true);
});

test("console errors or a failed load make the check fail", () => {
    assert.equal(qaPassed(result({ ok: false, status: 500 })), false);
    assert.equal(
        qaPassed(result({ consoleErrors: ["boom"], issues: ["1 browser console error(s)."] })),
        false,
    );
    assert.equal(qaPassed(result({ horizontalOverflow: true, issues: ["overflow"] })), false);
});

test("an unavailable browser never reports a pass", () => {
    assert.equal(qaPassed(result({ available: false, ok: false })), false);
});

test("screenshot paths are sanitized and stay inside the QA directory", () => {
    const directory = join(tmpdir(), "node-cli-qa-test");
    const path = screenshotPathFor("http://localhost:3000/", directory);
    assert.match(path, /qa-localhost-\d+\.png$/);
    assert.ok(path.startsWith(directory));
});
