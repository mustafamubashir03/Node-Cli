import { existsSync } from "node:fs";
import { printNotice, printFailure, printHint } from "./messages.js";

export interface VisualComparisonResult {
  referencePath: string;
  implementationPath: string;
  referenceExists: boolean;
  implementationExists: boolean;
  referenceSize: number;
  implementationSize: number;
  sizeMatch: boolean;
  identical: boolean;
  differencePercent: number | null;
  details: string;
}

/**
 * Basic visual comparison between two screenshots.
 * Uses file size and byte-level comparison as a proxy.
 * For pixel-level comparison, pixelmatch can be added as a dependency.
 */
export function compareScreenshots(
  referencePath: string,
  implementationPath: string
): VisualComparisonResult {
  const result: VisualComparisonResult = {
    referencePath,
    implementationPath,
    referenceExists: existsSync(referencePath),
    implementationExists: existsSync(implementationPath),
    referenceSize: 0,
    implementationSize: 0,
    sizeMatch: false,
    identical: false,
    differencePercent: null,
    details: "",
  };

  if (!result.referenceExists) {
    result.details = "Reference screenshot not found.";
    return result;
  }
  if (!result.implementationExists) {
    result.details = "Implementation screenshot not found.";
    return result;
  }

  try {
    const { readFileSync } = require("node:fs");
    const refBuffer = readFileSync(referencePath);
    const implBuffer = readFileSync(implementationPath);

    result.referenceSize = refBuffer.length;
    result.implementationSize = implBuffer.length;
    result.sizeMatch = refBuffer.length === implBuffer.length;
    result.identical = refBuffer.equals(implBuffer);

    if (result.identical) {
      result.differencePercent = 0;
      result.details = "Screenshots are identical.";
    } else {
      // Estimate difference based on size difference
      const sizeDiff = Math.abs(refBuffer.length - implBuffer.length);
      const avgSize = (refBuffer.length + implBuffer.length) / 2;
      const estimatedDiff = Math.min(100, (sizeDiff / avgSize) * 100);
      result.differencePercent = Math.round(estimatedDiff * 100) / 100;
      result.details = `Screenshots differ. Size difference: ${sizeDiff} bytes. For pixel-level comparison, install pixelmatch and pngjs.`;
    }
  } catch (error: any) {
    result.details = `Comparison failed: ${error.message}`;
  }

  return result;
}

/**
 * Generate a visual QA report.
 */
export function generateVisualQAReport(
  referencePath: string,
  implementationPath: string,
  viewport: { width: number; height: number }
): { comparison: VisualComparisonResult; report: string } {
  const comparison = compareScreenshots(referencePath, implementationPath);

  const report = [
    "# Visual QA Report",
    "",
    `Reference: ${referencePath}`,
    `Implementation: ${implementationPath}`,
    `Viewport: ${viewport.width}x${viewport.height}`,
    "",
    "## Comparison Results",
    `- Reference exists: ${comparison.referenceExists}`,
    `- Implementation exists: ${comparison.implementationExists}`,
    `- Reference size: ${comparison.referenceSize} bytes`,
    `- Implementation size: ${comparison.implementationSize} bytes`,
    `- Identical: ${comparison.identical}`,
    `- Estimated difference: ${comparison.differencePercent ?? "N/A"}%`,
    "",
    "## Details",
    comparison.details,
    "",
    "## Notes",
    "- This comparison uses file size and byte-level equality as a proxy.",
    "- For pixel-level comparison, install pixelmatch and pngjs.",
    "- Visual QA requires Playwright for screenshot capture.",
  ].join("\n");

  return { comparison, report };
}