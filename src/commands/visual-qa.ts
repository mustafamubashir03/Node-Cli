import { printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";
import { runBrowserQA } from "../ui/browser-qa.js";
import { compareScreenshots, generateVisualQAReport } from "../ui/visual-qa-compare.js";

export interface VisualQAOptions {
  url: string;
  referencePath?: string;
  screenshotPath?: string;
  viewport?: { width: number; height: number };
}

/**
 * Run visual QA on a URL.
 */
export async function runVisualQACommand(options: VisualQAOptions): Promise<void> {
  const { url, referencePath, screenshotPath, viewport = { width: 1280, height: 720 } } = options;

  printNotice(`Running visual QA on: ${url}`);

  // Capture screenshot
  const shotPath = screenshotPath || `./qa-screenshot-${Date.now()}.png`;
  const result = await runBrowserQA(url, { screenshotPath: shotPath });

  if (!result.available) {
    printFailure("Browser QA not available. Install Playwright.");
    for (const issue of result.issues) {
      printHint(`  - ${issue}`);
    }
    return;
  }

  printNotice(`Page: ${result.title} (HTTP ${result.status})`);
  if (result.consoleErrors.length > 0) {
    printFailure(`${result.consoleErrors.length} console error(s):`);
    for (const err of result.consoleErrors.slice(0, 5)) {
      printHint(`  - ${err}`);
    }
  }
  if (result.horizontalOverflow) {
    printFailure("Horizontal overflow detected at desktop and mobile viewports.");
  }

  // Compare with reference if provided
  if (referencePath && result.screenshotPath) {
    const { comparison, report } = generateVisualQAReport(referencePath, result.screenshotPath, viewport);
    printNotice(`Visual comparison: ${comparison.identical ? "IDENTICAL" : "DIFFERENT"}`);
    if (comparison.differencePercent !== null) {
      printHint(`Estimated difference: ${comparison.differencePercent}%`);
    }
    printHint(comparison.details);
  } else if (result.screenshotPath) {
    printSuccess(`Screenshot saved: ${result.screenshotPath}`);
    printHint("Provide a reference image with --reference for comparison.");
  }

  if (result.issues.length === 0) {
    printSuccess("Visual QA passed with no issues.");
  } else {
    printFailure(`${result.issues.length} issue(s) found.`);
    for (const issue of result.issues) {
      printHint(`  - ${issue}`);
    }
  }
}