import { style } from "./styles.js";

export interface VisualQAResult {
    /** True only when the tooling needed for a real browser check is present. */
    ready: boolean;
    issues: string[];
    checks: {
        nodeVersion: boolean;
        playwrightAvailable: boolean;
    };
}

/**
 * `require` does not exist in this ESM package. Check the optional dependency
 * with a dynamic import so `wake-up --visual-qa` reports availability instead
 * of crashing with "require is not defined".
 */
export async function isPlaywrightAvailable(): Promise<boolean> {
    try {
        // Held in a variable so the optional dependency is not a compile-time
        // requirement for users who only need the CLI.
        const optionalModule = "playwright";
        await import(optionalModule);
        return true;
    } catch {
        return false;
    }
}

export async function runVisualQA(): Promise<VisualQAResult> {
    const issues: string[] = [];

    const nodeVersion = process.version;
    const nodeVersionNum = Number.parseInt(nodeVersion.slice(1), 10);
    const nodeVersionOk = Number.isFinite(nodeVersionNum) && nodeVersionNum >= 18;
    if (!nodeVersionOk) {
        issues.push(
            `Node.js version ${nodeVersion} is below 18. Browser QA requires a supported Node.js release.`,
        );
    }

    const playwrightAvailable = await isPlaywrightAvailable();
    if (!playwrightAvailable) {
        issues.push(
            "Playwright is not installed, so no browser-based check can run. " +
                "Install it with: pnpm add -D playwright && pnpm exec playwright install chromium",
        );
    }

    return {
        ready: issues.length === 0,
        issues,
        checks: {
            nodeVersion: nodeVersionOk,
            playwrightAvailable,
        },
    };
}

/**
 * Prints readiness, not a quality verdict. A browser check requires a URL and
 * is performed by `node-cli qa <url>` or `/qa <url>`.
 */
export async function runVisualQASummary(): Promise<VisualQAResult> {
    const result = await runVisualQA();

    if (result.ready) {
        console.log(style.success("Browser QA tooling is available."));
        console.log("Run `node-cli qa <url>` (or `/qa <url>` inside chat) for a real check.");
    } else {
        console.log(style.warning("Browser QA is not ready:"));
        for (const issue of result.issues) {
            console.log(`  - ${issue}`);
        }
    }

    return result;
}
