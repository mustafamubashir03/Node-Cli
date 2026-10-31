export interface BrowserQAResult {
    available: boolean;
    url: string;
    ok: boolean;
    status: number | null;
    title: string;
    consoleErrors: string[];
    pageErrors: string[];
    horizontalOverflow: boolean;
    screenshotPath: string | null;
    issues: string[];
}

const PLAYWRIGHT_HINT =
    "Playwright is not installed. Install it with: pnpm add -D playwright && pnpm exec playwright install chromium";

/**
 * Performs load-time checks only: HTTP status, console/page errors, and
 * horizontal overflow at desktop and mobile widths. It cannot judge visual
 * design, and a screenshot must still be reviewed by a human.
 */
export async function runBrowserQA(
    url: string,
    options: { timeoutMs?: number; screenshotPath?: string } = {},
): Promise<BrowserQAResult> {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const result: BrowserQAResult = {
        available: false,
        url,
        ok: false,
        status: null,
        title: "",
        consoleErrors: [],
        pageErrors: [],
        horizontalOverflow: false,
        screenshotPath: null,
        issues: [],
    };

    let playwright: any;
    try {
        // Optional dependency: absent installs must degrade to a clear message.
        // The specifier is held in a variable so TypeScript does not require
        // playwright's types to be installed for the core package to compile.
        const optionalModule = "playwright";
        playwright = await import(optionalModule);
    } catch {
        result.issues.push(PLAYWRIGHT_HINT);
        return result;
    }
    result.available = true;

    const { chromium } = playwright;
    let browser: any;
    try {
        browser = await chromium.launch({ headless: true });
        const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

        page.on("console", (msg: any) => {
            if (msg.type() === "error") result.consoleErrors.push(String(msg.text()));
        });
        page.on("pageerror", (err: any) => {
            result.pageErrors.push(String(err?.message ?? err));
        });

        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
        result.status = response?.status() ?? null;

        // Do not fail the whole check when a page keeps a connection open
        // (analytics beacons, websockets, long polling).
        await page
            .waitForLoadState("networkidle", { timeout: Math.min(5_000, timeoutMs) })
            .catch(() => undefined);

        if (!response) {
            result.issues.push("The browser did not receive an HTTP response for this URL.");
        } else if (!response.ok()) {
            result.issues.push(`Page returned HTTP ${result.status ?? "unknown"}.`);
        } else {
            result.ok = true;
        }

        try {
            result.title = await page.title();
        } catch {
            result.title = "";
        }

        if (result.consoleErrors.length) {
            result.issues.push(`${result.consoleErrors.length} browser console error(s).`);
        }
        if (result.pageErrors.length) {
            result.issues.push(`${result.pageErrors.length} uncaught page error(s).`);
        }

        const desktopOverflow = await page.evaluate(
            "document.documentElement.scrollWidth > window.innerWidth + 1",
        );
        result.horizontalOverflow = Boolean(desktopOverflow);
        if (result.horizontalOverflow) {
            result.issues.push("Horizontal overflow detected at the 1280px desktop viewport.");
        }

        await page.setViewportSize({ width: 375, height: 812 });
        const mobileOverflow = await page.evaluate(
            "document.documentElement.scrollWidth > window.innerWidth + 1",
        );
        if (mobileOverflow) {
            result.issues.push("Horizontal overflow detected at the 375px mobile viewport.");
        }

        if (options.screenshotPath) {
            try {
                await page.screenshot({ path: options.screenshotPath, fullPage: true });
                result.screenshotPath = options.screenshotPath;
            } catch (error) {
                result.issues.push(
                    `Could not save a screenshot: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        result.issues.push(`Browser QA failed: ${message}`);
        if (/Executable doesn't exist|playwright install|browserType\.launch/i.test(message)) {
            result.issues.push(
                "The Playwright package is present but its Chromium build is missing. " +
                    "Run: pnpm exec playwright install chromium",
            );
        }
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch {
                // Closing a crashed browser must not hide the real findings.
            }
        }
    }

    return result;
}
