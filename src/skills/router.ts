import type { Catalog } from "../config/catalog.js";
import type { Mode } from "../agent/modes.js";
import { skillFileExists } from "./loader.js";

export type SkillScore = {
    id: string;
    score: number;
    reason: string;
};

export type RouterOptions = {
    mode: Mode;
    maxActive?: number;
    tokenBudget?: number;
    fileTypes?: string[];
    debug?: boolean;
};

export type RouterResult = {
    active: string[];
    scores: SkillScore[];
    budget: { used: number; limit: number; over: boolean };
};

export type SkillRouterOptions = {
    maxActive?: number;
    tokenBudget?: number;
    debug?: boolean;
    enabledSkills?: string[];
    /**
     * Availability gate. Defaults to "a SKILL.md exists" for direct catalog
     * use in tests; the chat passes the verified registry predicate.
     */
    isAvailable?: (id: string) => boolean;
};

const DEFAULT_MAX_ACTIVE = 3;
const DEFAULT_TOKEN_BUDGET = 6000;
const MIN_SCORE = 1;

export function isFrontendIntent(prompt: string): boolean {
    const promptLower = prompt.toLowerCase();
    if (/\b(?:pure backend|database migration|infrastructure only|cli only|api only|server only|data migration)\b/.test(promptLower)) {
        // But mixed frontend/backend should still count as frontend if UI is mentioned
        if (/\b(?:ui|frontend|website|page|screen|dashboard|component|landing|interface|design|layout|styling|css|html|react|next\.?js|vite|tailwind|responsive|animation)\b/.test(promptLower)) {
            // mixed case - allow
        } else {
            return false;
        }
    }
    const frontendSignals =
        /website|landing page|dashboard|application screen|frontend project|frontend task|ui screen|user interface/.test(promptLower) ||
        /\b(?:react|next\.?js|nextjs|vite|tailwind|css|scss|html|jsx|tsx)\b/.test(promptLower) && /\b(?:component|page|layout|style|ui|ux|design|screen|view)\b/.test(promptLower) ||
        /add (?:a|the)? component|modify component|create (?:a|the)? component/.test(promptLower) ||
        /navigation|form|responsive behavior|animation|visual state|visual bug|accessibility|inconsistent styling/.test(promptLower) ||
        /screenshot|design reference|website url|design system|implement.*design/.test(promptLower) ||
        /landing|hero section|navbar|header|footer/.test(promptLower) ||
        (/\b(?:build|create|implement|design)\b/.test(promptLower) && /\b(?:page|site|app|component|ui|interface)\b/.test(promptLower));
    return frontendSignals;
}

function taskBoost(id: string, promptLower: string): number {
    const designImprovement =
        /improve|redesign|polish|upgrade|elevate|next level|makeover|refresh/.test(promptLower) &&
        /design|ui|visual|aesthetic|layout|interface/.test(promptLower);
    if (designImprovement && (id === "frontend-design" || id === "baseline-ui" || id === "impeccable" || id === "beautify" || id === "hallmark")) return 4;

    const a11y = /accessibility|a11y|wcag|screen reader|keyboard|aria|contrast|focus/.test(promptLower);
    if (a11y && (id === "accessibility" || id === "fixing-accessibility")) return 6;

    const motion = /animation|motion|easing|spring|gesture|transition|drag|swipe/.test(promptLower);
    if (motion && (id === "emil-design-eng" || id === "improve-animations" || id === "review-animations" || id === "apple-design" || id === "fixing-motion-performance")) return 4;

    const debugging = /debug|bug|error|crash|broken|failing|root cause|not working/.test(promptLower);
    if (debugging && (id === "systematic-debugging" || id === "test-driven-development")) return 4;

    // Database guidance should follow database vocabulary, not generic
    // "API"/"server" words: an MCP server or a security audit is not a
    // Postgres task.
    const databaseWork =
        /\b(?:postgres|postgresql|sql|database|schema|migration|query performance|connection pooling|pgvector|rls|row-level security)\b/.test(promptLower);
    if (databaseWork && id === "postgres-best-practices") return 4;

    // MCP authoring is a distinct task; an ordinary API/Postgres request must
    // not pull in the MCP builder skill.
    const mcpAuthoring = /\b(?:mcp|model context protocol|fastmcp)\b/.test(promptLower);
    if (mcpAuthoring && id === "mcp-builder") return 4;

    const newFrontend = /build|create|implement|new (?:page|site|app|landing|component)/.test(promptLower) &&
        /page|site|app|landing|component|ui|frontend|website|interface/.test(promptLower) &&
        !/\b(?:api|endpoint|backend|server|route|database|postgres|sql|auth)\b(?!.*\b(?:ui|page|component|frontend)\b)/.test(promptLower);
    if (newFrontend && (id === "frontend-design" || id === "baseline-ui" || id === "web-design-guidelines")) return 3;

    return 0;
}

const MODE_SKILL_PENALTY: Record<string, string[]> = {
    ask: [
        "postgres-best-practices",
        "deploy-to-vercel",
        "mcp-builder",
        "web-artifacts-builder",
        "webapp-testing",
    ],
};

const FILE_TYPE_SKILLS: Record<string, string[]> = {
    ".ts": ["vercel-composition-patterns", "react-best-practices"],
    ".tsx": ["vercel-composition-patterns", "vercel-react-view-transitions", "react-best-practices"],
    ".js": ["vercel-composition-patterns", "react-best-practices"],
    ".jsx": ["vercel-composition-patterns", "vercel-react-view-transitions", "react-best-practices"],
    ".css": ["emil-design-eng", "apple-design", "frontend-design", "baseline-ui"],
    ".scss": ["emil-design-eng", "apple-design", "frontend-design", "baseline-ui"],
    ".py": ["systematic-debugging", "test-driven-development"],
    ".sql": ["postgres-best-practices"],
    ".md": ["fixing-metadata", "seo"],
    ".json": ["vercel-composition-patterns"],
    ".tailwind.config.js": ["tailwindcss-development"],
    "package.json": ["vercel-composition-patterns", "react-best-practices", "pick-ui-library"],
};

export class SkillRouter {
    private catalog: Catalog;
    private enabled: Set<string>;
    private maxActive: number;
    private tokenBudget: number;
    private debug: boolean;
    private isAvailable: (id: string) => boolean;

    constructor(catalog: Catalog, options: SkillRouterOptions = {}) {
        this.catalog = catalog;
        this.enabled = new Set(options.enabledSkills ?? []);
        this.maxActive = options.maxActive ?? DEFAULT_MAX_ACTIVE;
        this.tokenBudget = options.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
        this.debug = options.debug ?? false;
        this.isAvailable = options.isAvailable ?? skillFileExists;
    }

    route(prompt: string, options: RouterOptions): RouterResult {
        const {
            mode,
            maxActive = this.maxActive,
            tokenBudget = this.tokenBudget,
            fileTypes = [],
            debug = false,
        } = options;

        const scores = this.scorePrompt(prompt, mode, fileTypes);

        // Filter to enabled skills only
        const enabledScores = scores.filter((s) => this.enabled.has(s.id));

        // Apply conflict groups
        const afterConflicts = this.applyConflicts(enabledScores);

        // Sort by score descending
        afterConflicts.sort((a, b) => b.score - a.score);

        // Apply token budget
        const selected: string[] = [];
        let usedTokens = 0;
        for (const score of afterConflicts) {
            if (selected.length >= maxActive) break;
            const skill = this.catalog.skills[score.id];
            const tokens = skill?.contextTokens ?? 300;
            if (usedTokens + tokens > tokenBudget && selected.length > 0) break;
            selected.push(score.id);
            usedTokens += tokens;
        }

        if (debug) {
            console.log(`[skills/router] prompt: "${prompt}"`);
            console.log(
                `[skills/router] mode: ${mode}, maxActive: ${maxActive}, budget: ${tokenBudget}`,
            );
            console.log(
                `[skills/router] enabled skills: ${[...this.enabled].join(", ") || "none"}`,
            );
            for (const s of scores.slice(0, 8)) {
                const enabled = this.enabled.has(s.id) ? "enabled" : "disabled";
                console.log(`[skills/router]   ${s.id}: score=${s.score} (${enabled}) — ${s.reason}`);
            }
            console.log(
                `[skills/router]   selected: ${selected.join(", ") || "none"} (${usedTokens}/${tokenBudget} tokens)`,
            );
        }

        return {
            active: selected,
            scores: afterConflicts,
            budget: { used: usedTokens, limit: tokenBudget, over: usedTokens > tokenBudget },
        };
    }

    private scorePrompt(prompt: string, mode: string, fileTypes: string[]): SkillScore[] {
        const lower = prompt.toLowerCase();
        const scores: SkillScore[] = [];

        for (const [id, skill] of Object.entries(this.catalog.skills)) {
            if (skill.install === "removed") continue;

            // Skip skills that are not usable in this build/installation.
            if (!this.isAvailable(id)) continue;

            let triggerScore = 0;
            const matchedTriggers: string[] = [];

            for (const trigger of skill.triggers) {
                if (!matchesTrigger(lower, trigger)) continue;
                const words = trigger.trim().split(/\s+/).length;
                triggerScore += words > 1 ? 4 : 2;
                matchedTriggers.push(trigger);
            }

            const matchedFileTypes = fileTypes.filter((ext) =>
                (FILE_TYPE_SKILLS[ext] ?? []).includes(id),
            );
            const boost = taskBoost(id, lower);
            let score = triggerScore + matchedFileTypes.length + boost;

            if (score < MIN_SCORE) continue;

            // Mode penalty: ask mode penalizes editing/deploy skills.
            const penalties = MODE_SKILL_PENALTY[mode] ?? [];
            if (penalties.includes(id)) {
                score = Math.floor(score * 0.3);
            }
            if (score < 1) continue;

            const reasons: string[] = [];
            if (matchedTriggers.length > 0) {
                reasons.push(`triggers: ${matchedTriggers.join(", ")}`);
            }
            if (matchedFileTypes.length > 0) {
                reasons.push(`file types: ${matchedFileTypes.join(", ")}`);
            }

            scores.push({
                id,
                score,
                reason: reasons.join("; ") || "matched",
            });
        }

        scores.sort((a, b) => b.score - a.score);
        return scores;
    }

    private applyConflicts(scores: SkillScore[]): SkillScore[] {
        const activeIds = new Set(scores.map((s) => s.id));
        const results: SkillScore[] = [];

        for (const score of scores) {
            const group = this.findConflictGroup(score.id);
            if (!group) {
                results.push(score);
                continue;
            }

            // Check if any skill from this group is already selected
            const groupSkills = group.skills;
            const alreadySelected = groupSkills.some(
                (s) => activeIds.has(s) && results.some((r) => r.id === s),
            );

            if (group.rule === "exactly-one" && alreadySelected) {
                continue; // skip — another skill from this group wins
            }

            results.push(score);
            activeIds.add(score.id);
        }

        return results;
    }

    private findConflictGroup(skillId: string): { rule: string; skills: string[] } | null {
        for (const group of Object.values(this.catalog.conflictGroups)) {
            if (group.skills.includes(skillId)) {
                return group;
            }
        }
        return null;
    }

    getEnabledSkills(): string[] {
        return [...this.enabled];
    }

    isEnabled(id: string): boolean {
        return this.enabled.has(id);
    }
}

const TRIGGER_REGEX = new Map<string, RegExp>();

/**
 * Matches a trigger on word boundaries so short triggers such as "PR" do not
 * match inside "premium", and allows simple plurals ("rerender" -> "rerenders").
 */
export function matchesTrigger(text: string, trigger: string): boolean {
    const key = trigger.trim().toLowerCase();
    if (!key) return false;

    let pattern = TRIGGER_REGEX.get(key);
    if (!pattern) {
        let escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        escaped = escaped.replace(/-/g, "[- ]").replace(/\s+/g, "\\s+");
        const plural = /[a-z]$/.test(key) ? "(?:s|es)?" : "";
        pattern = new RegExp(`(?<![a-z0-9])${escaped}${plural}(?![a-z0-9])`, "i");
        TRIGGER_REGEX.set(key, pattern);
    }

    return pattern.test(text);
}

const KNOWN_EXTENSIONS = [
    ".tsx",
    ".ts",
    ".jsx",
    ".js",
    ".css",
    ".scss",
    ".html",
    ".py",
    ".sql",
    ".md",
    ".json",
] as const;

/** Detects file extensions mentioned in a prompt (not the whole repository). */
export function detectFileTypes(text: string): string[] {
    const found = new Set<string>();

    for (const ext of KNOWN_EXTENSIONS) {
        const escaped = ext.replace(/\./g, "\\.");
        if (new RegExp(`${escaped}(?![a-z0-9])`, "i").test(text)) {
            found.add(ext);
        }
    }
    if (/\bpackage\.json\b/i.test(text)) found.add("package.json");
    if (/\btailwind(?:\.config)?\.(?:js|ts)\b/i.test(text)) found.add(".tailwind.config.js");

    return [...found];
}

/**
 * A concise per-turn hint naming the highest-scoring skills. It is evidence of
 * ranking, not permission: the model still decides whether to activate one.
 */
export function formatSkillShortlist(result: RouterResult): string | null {
    if (result.active.length === 0) return null;
    const reasons = new Map(result.scores.map((score) => [score.id, score.reason]));
    const listed = result.active
        .map((id) => {
            const reason = reasons.get(id);
            return reason ? `${id} (${reason})` : id;
        })
        .join(", ");
    return `[skill-router] Ranked relevant skills for this message: ${listed}.`;
}
export function describeRouting(result: RouterResult): string {
    if (result.active.length === 0) {
        return `Skills: no match (considered ${result.scores.length})`;
    }
    const considered = result.scores
        .slice(0, 5)
        .map((score) => `${score.id}=${score.score}`)
        .join(", ");
    return `Skills: selected ${result.active.join(", ")} [${considered}]`;
}
