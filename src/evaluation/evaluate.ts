import { availableSkillIds, getSkillInfo } from "../skills/registry.js";
import { selectSkills } from "../skills/selection.js";
import {
    HIT_AT_K,
    type BucketSummary,
    type CaseEvaluation,
    type EvalReport,
    type EvalSummary,
    type GoldenCase,
    type LoadedDataset,
} from "./types.js";

export type EvaluateOptions = {
    availableSkills?: string[];
    now?: Date;
};

/**
 * Evaluates every case through the production selector. This is deterministic:
 * it does not call a model, read the network, or depend on elapsed time.
 */
export function evaluateDataset(
    loaded: LoadedDataset,
    options: EvaluateOptions = {},
): EvalReport {
    const availableSkills = options.availableSkills ?? availableSkillIds();
    const cases = loaded.dataset.cases.map((item) => evaluateCase(item, availableSkills));
    const summary = summarize(cases);

    return {
        schemaVersion: 1,
        generatedAt: (options.now ?? new Date()).toISOString(),
        dataset: {
            path: loaded.path,
            version: loaded.dataset.version,
            selectionVersion: loaded.dataset.selectionVersion,
            sha256: loaded.sha256,
            description: loaded.dataset.description,
        },
        catalog: {
            availableSkills,
            hitAtK: HIT_AT_K,
        },
        summary,
        byMode: bucketize(cases, (item) => [item.mode]),
        byTag: bucketize(cases, (item) => (item.tags.length > 0 ? item.tags : ["untagged"])),
        cases,
    };
}

export function evaluateCase(item: GoldenCase, availableSkills: string[]): CaseEvaluation {
    const mode = item.mode ?? "agent";
    const enabledSkills = item.enabledSkills && item.enabledSkills.length > 0
        ? item.enabledSkills
        : availableSkills;
    const expectedAny = item.expectedAny ?? [];
    const forbidden = item.forbidden ?? [];
    const expectNone = item.expectNone === true;

    const selection = selectSkills(item.prompt, { mode, enabledSkills });
    const selected = selection.selected;
    const expectedMatched = expectedAny.filter((id) => selected.includes(id));
    const forbiddenSelected = forbidden.filter((id) => selected.includes(id));

    const hitAt1 = expectedAny.length > 0 && selected.length > 0 && expectedAny.includes(selected[0]);
    const hitAtK = expectedAny.length > 0 && expectedMatched.length > 0;
    const expectationMet = expectNone ? selected.length === 0 : expectedMatched.length > 0;
    const emptySelection = selected.length === 0;
    const passed = expectationMet && forbiddenSelected.length === 0;

    return {
        id: item.id,
        prompt: item.prompt,
        mode,
        tags: item.tags ?? [],
        expectedAny,
        forbidden,
        expectNone,
        enabledSkills: [...enabledSkills],
        selected,
        recommended: selection.recommended,
        scores: selection.scores,
        budget: selection.budget,
        hitAt1,
        hitAtK,
        expectedMatched,
        forbiddenSelected,
        emptySelection,
        selectedTokens: selected.reduce((sum, id) => sum + getSkillInfo(id).contextTokens, 0),
        passed,
        failureReason: failureReason(passed, expectationMet, forbiddenSelected, expectNone),
    };
}

export function summarize(cases: CaseEvaluation[]): EvalSummary {
    const positive = cases.filter((item) => item.expectedAny.length > 0);
    const passed = cases.filter((item) => item.passed).length;
    const hitAt1 = positive.filter((item) => item.hitAt1).length;
    const hitAtK = positive.filter((item) => item.hitAtK).length;
    const forbiddenCaseIds = cases
        .filter((item) => item.forbiddenSelected.length > 0)
        .map((item) => item.id);
    const precisions = positive.map((item) =>
        item.selected.length === 0
            ? 0
            : item.expectedMatched.length / item.selected.length,
    );

    return {
        total: cases.length,
        positiveCases: positive.length,
        passed,
        failed: cases.length - passed,
        passRate: ratio(passed, cases.length),
        hitAt1,
        hitAt1Rate: ratio(hitAt1, positive.length),
        hitAtK,
        hitAtKRate: ratio(hitAtK, positive.length),
        forbiddenViolations: forbiddenCaseIds.length,
        forbiddenCaseIds,
        emptySelections: cases.filter((item) => item.emptySelection).length,
        budgetOverruns: cases.filter((item) => item.budget.over).length,
        averageSelectedCount: average(cases.map((item) => item.selected.length)),
        averageRequiredPrecision: average(precisions),
        averageSelectedTokens: average(cases.map((item) => item.selectedTokens)),
    };
}

export function bucketize(
    cases: CaseEvaluation[],
    keys: (item: CaseEvaluation) => string[],
): Record<string, BucketSummary> {
    const groups = new Map<string, CaseEvaluation[]>();
    for (const item of cases) {
        for (const key of keys(item)) {
            const bucket = groups.get(key) ?? [];
            bucket.push(item);
            groups.set(key, bucket);
        }
    }

    const result: Record<string, BucketSummary> = {};
    for (const [key, items] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
        const positive = items.filter((item) => item.expectedAny.length > 0);
        result[key] = {
            total: items.length,
            positiveCases: positive.length,
            passed: items.filter((item) => item.passed).length,
            passRate: ratio(items.filter((item) => item.passed).length, items.length),
            hitAt1Rate: ratio(positive.filter((item) => item.hitAt1).length, positive.length),
            hitAtKRate: ratio(positive.filter((item) => item.hitAtK).length, positive.length),
            forbiddenViolations: items.filter((item) => item.forbiddenSelected.length > 0).length,
        };
    }
    return result;
}

function failureReason(
    passed: boolean,
    expectationMet: boolean,
    forbiddenSelected: string[],
    expectNone: boolean,
): string | null {
    if (passed) return null;
    if (forbiddenSelected.length > 0) {
        return `Selected forbidden skill(s): ${forbiddenSelected.join(", ")}.`;
    }
    if (expectNone) return "Expected no skill selection, but the selector returned a shortlist.";
    if (!expectationMet) return "None of the expected skills were selected.";
    return "Unknown failure.";
}

function ratio(part: number, whole: number): number {
    return whole === 0 ? 0 : part / whole;
}

function average(values: number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
