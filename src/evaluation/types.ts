import type { Mode } from "../agent/modes.js";
import type { SkillScore, RouterResult } from "../skills/router.js";

export const EVAL_SCHEMA_VERSION = 1;
export const HIT_AT_K = 3;

export type GoldenCase = {
    /** Stable, unique, kebab-case identifier. */
    id: string;
    prompt: string;
    mode?: Mode;
    /** Enabled skills for this case; defaults to every available skill. */
    enabledSkills?: string[];
    /** At least one of these must be selected. */
    expectedAny?: string[];
    /** None of these may be selected. */
    forbidden?: string[];
    /** The prompt should not select any skill. */
    expectNone?: boolean;
    tags?: string[];
    notes?: string;
};

export type GoldenDataset = {
    version: number;
    selectionVersion: string;
    description: string;
    cases: GoldenCase[];
};

export type LoadedDataset = {
    dataset: GoldenDataset;
    path: string;
    sha256: string;
};

export type CaseEvaluation = {
    id: string;
    prompt: string;
    mode: Mode;
    tags: string[];
    expectedAny: string[];
    forbidden: string[];
    expectNone: boolean;
    enabledSkills: string[];
    selected: string[];
    recommended: string[];
    scores: SkillScore[];
    budget: RouterResult["budget"];
    hitAt1: boolean;
    hitAtK: boolean;
    expectedMatched: string[];
    forbiddenSelected: string[];
    emptySelection: boolean;
    selectedTokens: number;
    passed: boolean;
    failureReason: string | null;
};

export type EvalSummary = {
    total: number;
    positiveCases: number;
    passed: number;
    failed: number;
    passRate: number;
    hitAt1: number;
    hitAt1Rate: number;
    hitAtK: number;
    hitAtKRate: number;
    forbiddenViolations: number;
    forbiddenCaseIds: string[];
    emptySelections: number;
    budgetOverruns: number;
    averageSelectedCount: number;
    averageRequiredPrecision: number;
    averageSelectedTokens: number;
};

export type BucketSummary = {
    total: number;
    positiveCases: number;
    passed: number;
    passRate: number;
    hitAt1Rate: number;
    hitAtKRate: number;
    forbiddenViolations: number;
};

export type EvalReport = {
    schemaVersion: number;
    generatedAt: string;
    dataset: {
        path: string;
        version: number;
        selectionVersion: string;
        sha256: string;
        description: string;
    };
    catalog: {
        availableSkills: string[];
        hitAtK: number;
    };
    summary: EvalSummary;
    byMode: Record<string, BucketSummary>;
    byTag: Record<string, BucketSummary>;
    cases: CaseEvaluation[];
};

export class DatasetError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "DatasetError";
    }
}

export function isMode(value: unknown): value is Mode {
    return value === "agent" || value === "ask" || value === "plan" || value === "strict";
}
