import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { runBrowserQA, type BrowserQAResult } from "../ui/browser-qa.js";
import {
    printFailure,
    printHint,
    printNotice,
    printSuccess,
    printWarning,
} from "../ui/messages.js";

export type QaTargetResult = { ok: true; url: string } | { ok: false; error: string };

/**
 * Accepts an explicit http(s) URL or a bare localhost address. Other schemes
 * (file:, javascript:, data:) are rejected: this tool loads pages in a real
 * browser and should not be handed non-web targets.
 */
export function parseQaTarget(raw: string): QaTargetResult {
    const trimmed = raw.trim();
    if (!trimmed) {
        return { ok: false, error: "Usage: /qa <url> (for example /qa http://localhost:3000)" };
    }

    const candidate = /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:[/?#]|$)/i.test(trimmed)
        ? `http://${trimmed}`
        : trimmed;

    let parsed: URL;
    try {
        parsed = new URL(candidate);
    } catch {
        return { ok: false, error: `'${trimmed}' is not a valid URL.` };
    }

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return { ok: false, error: `Only http:// and https:// URLs can be checked, not ${parsed.protocol}` };
    }
    if (!parsed.hostname) {
        return { ok: false, error: `'${trimmed}' has no host.` };
    }

    return { ok: true, url: parsed.href };
}

export function qaPassed(result: BrowserQAResult): boolean {
    return result.available && result.ok && result.issues.length === 0;
}

export function screenshotPathFor(url: string, directory: string = join(tmpdir(), "node-cli-qa")): string {
    const host = (() => {
        try {
            return new URL(url).hostname.replace(/[^A-Za-z0-9.-]/g, "_");
        } catch {
            return "page";
        }
    })();
    return join(directory, `qa-${host}-${Date.now()}.png`);
}

export async function runQaCommand(argument: string): Promise<number> {
    const target = parseQaTarget(argument);
    if (!target.ok) {
        printFailure(target.error);
        return 1;
    }

    const screenshotPath = screenshotPathFor(target.url);
    mkdirSync(dirname(screenshotPath), { recursive: true });

    printNotice(`Checking ${target.url} in a headless browser...`);
    const result = await runBrowserQA(target.url, { screenshotPath });

    if (!result.available) {
        printFailure("Browser QA is unavailable.");
        for (const issue of result.issues) printHint(issue);
        return 1;
    }

    if (result.ok) {
        printSuccess(`Page loaded${result.status ? ` (HTTP ${result.status})` : ""}: ${result.url}`);
    } else {
        printFailure(`Page did not load successfully: ${result.url}`);
    }
    if (result.title) {
        printHint(`Title: ${result.title}`);
    }

    if (result.consoleErrors.length > 0) {
        printWarning(`${result.consoleErrors.length} console error(s):`);
        for (const error of result.consoleErrors.slice(0, 10)) printHint(`  ${error}`);
    }
    if (result.pageErrors.length > 0) {
        printWarning(`${result.pageErrors.length} uncaught page error(s):`);
        for (const error of result.pageErrors.slice(0, 10)) printHint(`  ${error}`);
    }

    for (const issue of result.issues) {
        printHint(`  - ${issue}`);
    }

    if (result.screenshotPath) {
        printHint(`Screenshot: ${result.screenshotPath}`);
    }

    const passed = qaPassed(result);
    if (passed) {
        printSuccess("Browser checks passed: page loaded with no console errors and no horizontal overflow.");
    } else {
        printFailure("Browser checks found problems.");
    }
    printHint(
        "This checks loading, console errors, and overflow only. It does not judge visual design; review the screenshot yourself.",
    );

    return passed ? 0 : 1;
}
