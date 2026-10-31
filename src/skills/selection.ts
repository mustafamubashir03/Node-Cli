import type { Mode } from "../agent/modes.js";
import { availableEnabledSkills, availableSkillIds, routingCatalog } from "./registry.js";
import {
    SkillRouter,
    detectFileTypes,
    type RouterResult,
    type SkillScore,
} from "./router.js";

/**
 * Identifies the selection policy in diagnostics. Bump this when routing rules
 * change so evaluation reports remain comparable across runs.
 */
export const SKILL_SELECTION_VERSION = "router-v1";

export const DEFAULT_MAX_ACTIVE = 3;
export const DEFAULT_SKILL_TOKEN_BUDGET = 6000;

export type SkillSelection = {
    /** Every skill that is usable in this installation. */
    candidates: string[];
    /** Skills enabled by configuration and filtered through the availability gate. */
    enabled: string[];
    /** Router ranking used as the per-message recommendation. */
    recommended: string[];
    /**
     * Skills the production path decided to put in front of the model. Today the
     * recommendation is the selection (a shortlist); this stays a separate field
     * so a future enforced-selection policy does not need a schema change.
     */
    selected: string[];
    scores: SkillScore[];
    budget: RouterResult["budget"];
};

export type SkillSelectionOptions = {
    mode: Mode;
    enabledSkills?: string[];
    maxActive?: number;
    tokenBudget?: number;
    /** Overrides file-type detection; useful for evaluation fixtures. */
    fileTypes?: string[];
};

/**
 * The single production selection entry point. Interactive chat, one-shot runs,
 * and the golden-dataset evaluator all call this so the evaluator measures the
 * same code path users run.
 */
export function selectSkills(
    prompt: string,
    options: SkillSelectionOptions,
): SkillSelection {
    const enabled = availableEnabledSkills(options.enabledSkills ?? []);
    const router = new SkillRouter(routingCatalog(), {
        enabledSkills: enabled,
        maxActive: options.maxActive ?? DEFAULT_MAX_ACTIVE,
        tokenBudget: options.tokenBudget ?? DEFAULT_SKILL_TOKEN_BUDGET,
    });

    const result = router.route(prompt, {
        mode: options.mode,
        fileTypes: options.fileTypes ?? detectFileTypes(prompt),
    });

    return {
        candidates: availableSkillIds(),
        enabled,
        recommended: result.active,
        selected: result.active,
        scores: result.scores,
        budget: result.budget,
    };
}

export function toRouterResult(selection: SkillSelection): RouterResult {
    return {
        active: selection.selected,
        scores: selection.scores,
        budget: selection.budget,
    };
}
