import { catalog, getSkill, type SkillEntry } from "../config/catalog.js";
import { isFrontendIntent } from "./router.js";

/**
 * Roles used when consulting references for a frontend task. These are roles,
 * not hardcoded repository mandates: the selector chooses the actual source
 * that best fits the task/stack among the catalog entries available for each role.
 */
export const FRONTEND_REFERENCE_ROLES = [
    "design-intelligence",
    "art-direction",
    "design-system",
    "component-source",
    "interaction",
    "quality-review",
] as const;

export type FrontendReferenceRole = (typeof FRONTEND_REFERENCE_ROLES)[number];

export type FrontendReferenceConsultation = {
    /** True when the prompt was classified as a frontend task. */
    frontend: boolean;
    /** Distinct catalog ids that were consulted (metadata/index only). */
    consulted: string[];
    /** Role -> chosen catalog id (or null when no applicable source). */
    byRole: Record<FrontendReferenceRole, string | null>;
    /** Reason when fewer than five references could be consulted. */
    exception: string | null;
};

const ROLE_CANDIDATES: Record<FrontendReferenceRole, string[]> = {
    "design-intelligence": ["ui-ux-pro-max", "taste-skill", "emilkowalski-skills-repo", "frontend-design"],
    "art-direction": ["taste-skill", "beautify", "frontend-design", "no-ai-slop"],
    "design-system": ["awesome-design-md", "design-md-google", "tailwindcss-development"],
    "component-source": ["react-bits", "magicui", "canvas-ui"],
    "interaction": ["emil-design-eng", "gsap-skills", "apple-design", "fixing-motion-performance"],
    "quality-review": ["impeccable", "pbakaus-impeccable", "hallmark", "hallmark-ref", "web-design-guidelines", "accessibility", "fixing-accessibility"],
};

function isAvailableInCatalog(id: string): boolean {
    return Boolean(getSkill(id));
}

function pickForRole(role: FrontendReferenceRole, promptLower: string, used: Set<string>): string | null {
    const candidates = ROLE_CANDIDATES[role];
    for (const id of candidates) {
        if (used.has(id)) continue;
        if (!isAvailableInCatalog(id)) continue;
        // Stack gating for component-source: only consult when React-ish task.
        if (role === "component-source") {
            if (!/\b(?:react|next\.?js|nextjs|component|tsx|jsx)\b/.test(promptLower)) continue;
        }
        // GSAP only when requested or complex animation.
        if (id === "gsap-skills") {
            if (!/\b(?:gsap|timeline|scrolltrigger|complex animation|scroll-based)\b/.test(promptLower)) continue;
        }
        // Canvas UI only when WebGL/WebGPU/canvas requested.
        if (id === "canvas-ui") {
            if (!/\b(?:canvas|webgl|webgpu|3d)\b/.test(promptLower)) continue;
        }
        // Dimensional drawing only for reproduction/spec tasks (not a default role).
        return id;
    }
    return null;
}

export function consultFrontendReferences(prompt: string): FrontendReferenceConsultation {
    const frontend = isFrontendIntent(prompt);
    const byRole: Record<FrontendReferenceRole, string | null> = {
        "design-intelligence": null,
        "art-direction": null,
        "design-system": null,
        "component-source": null,
        "interaction": null,
        "quality-review": null,
    };
    const consulted: string[] = [];
    const used = new Set<string>();

    if (!frontend) {
        return { frontend, consulted, byRole, exception: "Not a frontend task; no frontend references consulted." };
    }

    const promptLower = prompt.toLowerCase();
    for (const role of FRONTEND_REFERENCE_ROLES) {
        const chosen = pickForRole(role, promptLower, used);
        byRole[role] = chosen;
        if (chosen) {
            used.add(chosen);
            consulted.push(chosen);
        }
    }

    let exception: string | null = null;
    if (consulted.length < 5) {
        exception = `Only ${consulted.length} of 5-6 applicable references found; some roles had no applicable source.`;
    }
    return { frontend, consulted, byRole, exception };
}
