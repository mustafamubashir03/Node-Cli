import { test } from "node:test";
import assert from "node:assert/strict";
import { isSpinnerActive, resumeSpinner, startSpinner, stopSpinner, suspendSpinner } from "./spinner.js";

test("suspend and resume are idempotent", () => {
    stopSpinner();
    startSpinner("Agent working...");
    suspendSpinner();
    suspendSpinner();
    assert.equal(isSpinnerActive(), false);

    resumeSpinner();
    assert.equal(isSpinnerActive(), true, "resume restores the spinner");
    resumeSpinner();

    stopSpinner();
    assert.equal(isSpinnerActive(), false);
});