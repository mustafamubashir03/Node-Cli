import { join } from "node:path";
import { DatasetError } from "../evaluation/types.js";
import { loadDataset } from "../evaluation/dataset.js";
import { evaluateDataset } from "../evaluation/evaluate.js";
import { formatCaseLine, writeEvalReport } from "../evaluation/report.js";
import type { EvalReport } from "../evaluation/types.js";
import { describeError, printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";

export type EvalCommandOptions = {
    datasetPath?: string;
    jsonPath?: string;
    markdownPath?: string;
    verbose?: boolean;
    failOnMiss?: boolean;
};

const DEFAULT_DATASET = join("evaluation", "skill-selection.v1.json");

/**
 * Deterministic evaluation CLI. Exits non-zero only for usage/dataset errors or
 * when --fail-on-miss is set and a case fails; a failing case is data, not a
 * crash.
 */
export async function runEvalCommand(options: EvalCommandOptions = {}): Promise<number> {
    const datasetPath = options.datasetPath?.trim() || DEFAULT_DATASET;

    let loaded;
    try {
        loaded = loadDataset(datasetPath);
    } catch (error) {
        if (error instanceof DatasetError) {
            printFailure(`Dataset error: ${error.message}`);
            return 1;
        }
        printFailure(`Could not load the dataset: ${describeError(error)}`);
        return 1;
    }

    if (loaded.dataset.selectionVersion === undefined || !loaded.dataset.selectionVersion) {
        printFailure("Dataset is missing a selectionVersion.");
        return 1;
    }

    const report = evaluateDataset(loaded);
    printNotice(
        `Evaluated ${report.summary.total} cases with ${report.catalog.availableSkills.length} available skills.`,
    );
    printNotice(
        `Pass ${report.summary.passed}/${report.summary.total} (${percent(report.summary.passRate)}); ` +
            `hit@1 ${report.summary.hitAt1}/${report.summary.positiveCases}; ` +
            `hit@${report.catalog.hitAtK} ${report.summary.hitAtK}/${report.summary.positiveCases}; ` +
            `forbidden ${report.summary.forbiddenViolations}.`,
    );

    if (options.verbose) {
        for (const item of report.cases) {
            printNotice(formatCaseLine(item));
        }
    }

    const failures = report.cases.filter((item) => !item.passed);
    if (failures.length > 0) {
        printNotice(`Failures (${failures.length}):`);
        for (const item of failures) {
            printFailure(`  ${formatCaseLine(item)}`);
        }
    } else {
        printSuccess("All cases matched their labels.");
    }

    const stamp = stampFor(report.generatedAt);
    const jsonPath = options.jsonPath?.trim() ||
        join("evaluation", "reports", `skill-selection-${loaded.dataset.selectionVersion}-${stamp}.json`);
    const markdownPath = options.markdownPath?.trim() ||
        jsonPath.replace(/\.json$/i, "") + ".md";

    try {
        const written = writeEvalReport(report, jsonPath, markdownPath);
        printHint(`Evaluation JSON: ${written.jsonPath}`);
        printHint(`Evaluation report: ${written.markdownPath}`);
    } catch (error) {
        printFailure(`Could not write the evaluation report: ${describeError(error)}`);
        return 1;
    }

    if (options.failOnMiss && report.summary.failed > 0) {
        return 1;
    }
    return 0;
}

function percent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function stampFor(iso: string): string {
    return iso.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
}
