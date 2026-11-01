import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { CaseEvaluation, EvalReport } from "./types.js";

export function formatEvalReport(report: EvalReport): string {
    const s = report.summary;
    const lines: string[] = [
        `# Skill selection evaluation — ${report.dataset.selectionVersion}`,
        "",
        `- Generated: ${report.generatedAt}`,
        `- Dataset: \`${report.dataset.path}\` (version ${report.dataset.version}, sha256 \`${report.dataset.sha256.slice(0, 16)}…\`)`,
        `- Dataset size: ${s.total} cases (${s.positiveCases} positive, ${s.total - s.positiveCases} expect-none)`,
        `- Available skills: ${report.catalog.availableSkills.length}`,
        `- Hit@${report.catalog.hitAtK}: ${percent(s.hitAtKRate)} (${s.hitAtK}/${s.positiveCases})`,
        `- Hit@1: ${percent(s.hitAt1Rate)} (${s.hitAt1}/${s.positiveCases})`,
        `- Pass rate: ${percent(s.passRate)} (${s.passed}/${s.total})`,
        "",
        "This evaluation is deterministic. It calls the production selector only; it does not",
        "invoke a model, and no thresholds were tuned against these labels.",
        "",
        "## Aggregate metrics",
        "",
        "| Metric | Value |",
        "|---|---|",
        `| Passed | ${s.passed}/${s.total} (${percent(s.passRate)}) |`,
        `| Hit@1 | ${s.hitAt1}/${s.positiveCases} (${percent(s.hitAt1Rate)}) |`,
        `| Hit@${report.catalog.hitAtK} | ${s.hitAtK}/${s.positiveCases} (${percent(s.hitAtKRate)}) |`,
        `| Forbidden-skill violations | ${s.forbiddenViolations} |`,
        `| Empty selections | ${s.emptySelections} |`,
        `| Budget overruns | ${s.budgetOverruns} |`,
        `| Average selected skills | ${s.averageSelectedCount.toFixed(2)} |`,
        `| Average required-skill precision | ${percent(s.averageRequiredPrecision)} |`,
        `| Average selected tokens | ${s.averageSelectedTokens.toFixed(1)} |`,
        "",
        "`Hit` measures whether any expected skill was selected. `Required-skill precision`",
        "is the share of selected skills that were named as expected; it is a lower bound",
        "because the labels do not enumerate every reasonable alternative.",
        "",
    ];

    lines.push("## By mode", "");
    lines.push(...bucketTable(report.byMode));
    lines.push("");

    lines.push("## By tag", "");
    lines.push(...bucketTable(report.byTag));
    lines.push("");

    const failures = report.cases.filter((item) => !item.passed);
    lines.push("## Failures", "");
    if (failures.length === 0) {
        lines.push("None.", "");
    } else {
        for (const item of failures) {
            lines.push(`### ${item.id}`, "");
            lines.push(`- Prompt: ${item.prompt}`);
            lines.push(`- Mode: \`${item.mode}\``);
            lines.push(`- Expected any: ${list(item.expectedAny)}`);
            lines.push(`- Forbidden: ${list(item.forbidden)}`);
            lines.push(`- Selected: ${list(item.selected)}`);
            lines.push(`- Reason: ${item.failureReason ?? "unknown"}`);
            const ranked = item.scores
                .slice(0, 5)
                .map((score) => `${score.id}=${score.score}`)
                .join(", ");
            lines.push(`- Top-ranked candidates: ${ranked || "none"}`);
            lines.push("");
        }
    }

    lines.push("## Cases", "");
    lines.push(
        "| Case | Mode | Expected any | Selected | Hit@1 | Pass |",
        "|---|---|---|---|---|---|",
    );
    for (const item of report.cases) {
        lines.push(
            `| ${cell(item.id)} | ${item.mode} | ${cell(list(item.expectedAny))} | ${cell(list(item.selected))} | ${item.hitAt1 ? "yes" : "no"} | ${item.passed ? "yes" : "no"} |`,
        );
    }
    lines.push("");

    lines.push("## Reproduction", "");
    lines.push("```");
    lines.push(`node dist/index.js eval ${report.dataset.path}`);
    lines.push("```");
    lines.push("");

    return lines.join("\n");
}

export function writeEvalReport(
    report: EvalReport,
    jsonPath: string,
    markdownPath: string,
): { jsonPath: string; markdownPath: string } {
    mkdirSync(dirname(jsonPath), { recursive: true });
    writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n");

    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, formatEvalReport(report));

    return { jsonPath, markdownPath };
}

function bucketTable(buckets: EvalReport["byMode"]): string[] {
    const rows = Object.entries(buckets).map(
        ([name, bucket]) =>
            `| ${cell(name)} | ${bucket.total} | ${bucket.passed} | ${percent(bucket.passRate)} | ${percent(bucket.hitAt1Rate)} | ${percent(bucket.hitAtKRate)} | ${bucket.forbiddenViolations} |`,
    );
    return [
        "| Bucket | Cases | Passed | Pass rate | Hit@1 | Hit@3 | Forbidden |",
        "|---|---|---|---|---|---|---|",
        ...rows,
    ];
}

export function formatCaseLine(item: CaseEvaluation): string {
    const expected = item.expectNone ? "(none)" : list(item.expectedAny);
    return [
        item.passed ? "PASS" : "FAIL",
        item.id,
        `mode=${item.mode}`,
        `expected=${expected}`,
        `selected=${list(item.selected)}`,
        item.failureReason ? `reason=${item.failureReason}` : "",
    ]
        .filter(Boolean)
        .join(" | ");
}

function percent(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function list(values: string[]): string {
    return values.length === 0 ? "none" : values.join(", ");
}

function cell(text: string): string {
    return text.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
