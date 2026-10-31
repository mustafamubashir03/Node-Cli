import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRequestGate, recordProviderFailure, recordRequest } from "./usage-counter.js";
import type { ProviderFailure } from "../agent/provider-errors.js";

function withUsageFile(run: () => void): void {
    const dir = mkdtempSync(join(tmpdir(), "node-cli-usage-"));
    const previous = process.env.NODE_CLI_USAGE_PATH;
    process.env.NODE_CLI_USAGE_PATH = join(dir, "usage.json");
    try {
        run();
    } finally {
        if (previous === undefined) {
            delete process.env.NODE_CLI_USAGE_PATH;
        } else {
            process.env.NODE_CLI_USAGE_PATH = previous;
        }
        rmSync(dir, { recursive: true, force: true });
    }
}

function failure(kind: ProviderFailure["kind"], retryAfterMs: number | null = null): ProviderFailure {
    return {
        kind,
        retryable: kind === "rate_limit",
        status: kind === "rate_limit" ? 429 : null,
        retryAfterMs,
        message: "test failure",
        action: "test",
    };
}

test("a recorded rate limit blocks the next request without resending it", () => {
    withUsageFile(() => {
        assert.equal(recordRequest().allowed, true);
        recordProviderFailure(failure("rate_limit", 30_000));

        const blocked = recordRequest();
        assert.equal(blocked.allowed, false);
        assert.match(blocked.minuteWarning ?? "", /rate limit/i);
        assert.match(blocked.minuteWarning ?? "", /not resent/i);

        const gate = checkRequestGate();
        assert.equal(gate.allowed, false);
    });
});

test("an exhausted quota blocks further requests with guidance to add credits", () => {
    withUsageFile(() => {
        recordProviderFailure(failure("quota"));
        const blocked = recordRequest();
        assert.equal(blocked.allowed, false);
        assert.match(blocked.minuteWarning ?? "", /quota/i);
        assert.match(blocked.minuteWarning ?? "", /[Cc]redits/);
    });
});

test("an auth failure blocks retries with a setup hint", () => {
    withUsageFile(() => {
        recordProviderFailure(failure("auth"));
        const blocked = recordRequest();
        assert.equal(blocked.allowed, false);
        assert.match(blocked.minuteWarning ?? "", /Authentication failed/);
        assert.match(blocked.minuteWarning ?? "", /node-cli setup/);
    });
});

test("transient server failures do not create a cooldown", () => {
    withUsageFile(() => {
        recordProviderFailure(failure("server"));
        assert.equal(recordRequest().allowed, true);
    });
});

test("a very long Retry-After is capped so the CLI cannot lock itself out", () => {
    withUsageFile(() => {
        recordProviderFailure(failure("rate_limit", 7 * 24 * 60 * 60 * 1000));
        assert.equal(recordRequest().allowed, false);
        const gate = checkRequestGate();
        assert.equal(gate.allowed, false);
    });
});
