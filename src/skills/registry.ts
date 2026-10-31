import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { catalog, getSkill, type Catalog, type SkillEntry } from "../config/catalog.js";
import {
    getBuiltinSkillsDir,
    getSkillReleaseStatus,
    getUserSkillsDir,
    isValidSkillId,
    parseSkillFrontmatter,
    resolveUserSkillDir,
    summarizeSkillBody,
    type SkillBody,
} from "./loader.js";

export type SkillAvailability = "available" | "unverified" | "missing" | "unknown";

export type SkillSource = "builtin" | "user" | "none";

export type SkillInfo = {
    id: string;
    name: string;
    description: string;
    category: string;
    triggers: string[];
    contextTokens: number;
    source: SkillSource;
    availability: SkillAvailability;
    /** Absolute path to SKILL.md when the skill is installed. */
    path: string | null;
    /** Human-readable explanation when the skill cannot be used. */
    reason: string | null;
};

export type SkillIndexEntry = {
    id: string;
    name: string;
    description: string;
    contextTokens: number;
};

const CUSTOM_CATEGORY = {
    label: "Custom",
    description: "Skills installed by the user",
};

/**
 * The single source of truth for whether a skill may be activated and routed.
 *
 * Precedence:
 * 1. A readable skill in the user install directory is available. The user
 *    chose to put it there, and the release lock only covers bundled content.
 * 2. A bundled skill is available only when the release manifest verifies it
 *    AND the file exists in this build. A file in the source tree does not
 *    make an unverified skill usable, so dev and packaged behavior match.
 */
export function getSkillInfo(id: string): SkillInfo {
    if (!isValidSkillId(id)) {
        return unavailable(id, "unknown", "none", "Invalid skill id.");
    }

    const userBody = readSkillFile(id, join(resolveUserSkillDir(id), "SKILL.md"));
    if (userBody) {
        return availableInfo(id, userBody, "user", getSkill(id));
    }

    const entry = getSkill(id);
    if (!entry) {
        return unavailable(
            id,
            "unknown",
            "none",
            `Skill '${id}' is not in the catalog and is not installed in ${getUserSkillsDir()}.`,
        );
    }

    if (entry.install === "removed") {
        return unavailable(id, "unknown", "none", `Skill '${id}' was removed from the catalog.`);
    }

    const releaseStatus = getSkillReleaseStatus(id);
    const builtinBody = readSkillFile(id, join(getBuiltinSkillsDir(), id, "SKILL.md"));

    if (entry.install === "on-demand" && !builtinBody) {
        return unavailable(
            id,
            "missing",
            "none",
            `Skill '${id}' is available on demand. Install it with /skills fetch ${id} or /skills add <github-tree-url>.`,
        );
    }

    if (releaseStatus !== "verified") {
        return unavailable(
            id,
            "unverified",
            "none",
            `Skill '${id}' is not verified for this release and is excluded from the build. Do not retry activation; choose a verified skill instead.`,
        );
    }

    if (!builtinBody) {
        return unavailable(
            id,
            "missing",
            "none",
            `Skill '${id}' is verified but its release copy is missing from this installation. Reinstall node-cli.`,
        );
    }

    return availableInfo(id, builtinBody, "builtin", entry);
}

export function isSkillAvailable(id: string): boolean {
    return getSkillInfo(id).availability === "available";
}

export function availableSkillIds(): string[] {
    return listSkillInfos()
        .filter((info) => info.availability === "available")
        .map((info) => info.id);
}

export function listSkillInfos(): SkillInfo[] {
    const ids = new Set<string>(Object.keys(catalog.skills));

    const userRoot = getUserSkillsDir();
    if (existsSync(userRoot)) {
        try {
            for (const entry of readdirSync(userRoot)) {
                if (isValidSkillId(entry)) ids.add(entry);
            }
        } catch {
            // A missing or unreadable user directory simply contributes nothing.
        }
    }

    return [...ids].map((id) => getSkillInfo(id)).sort((a, b) => a.id.localeCompare(b.id));
}

/** Available skills only, as prompt-index entries with real descriptions. */
export function skillIndex(ids: string[]): SkillIndexEntry[] {
    const entries: SkillIndexEntry[] = [];
    for (const id of ids) {
        const info = getSkillInfo(id);
        if (info.availability !== "available") continue;
        entries.push({
            id: info.id,
            name: info.name,
            description: info.description,
            contextTokens: info.contextTokens,
        });
    }
    return entries;
}

/**
 * A catalog view containing only usable skills. `SkillRouter` can therefore
 * never select an unverified or missing skill, even if a stale config names it.
 */
export function routingCatalog(): Catalog {
    const skills: Record<string, SkillEntry> = {};

    for (const info of listSkillInfos()) {
        if (info.availability !== "available") continue;
        const existing = getSkill(info.id);
        skills[info.id] = {
            name: info.name,
            category: info.category,
            sourceRepo: existing?.sourceRepo ?? null,
            sourceUrl: existing?.sourceUrl ?? null,
            license: existing?.license ?? null,
            install: existing?.install ?? "on-demand",
            triggers: info.triggers,
            contextTokens: info.contextTokens,
        };
    }

    const hasCustomCategory = Object.values(skills).some((skill) => skill.category === "custom");
    const categories = hasCustomCategory
        ? { ...catalog.categories, custom: CUSTOM_CATEGORY }
        : catalog.categories;

    return { ...catalog, categories, skills };
}

/** Filters configured skill ids down to those that can actually be used. */
export function availableEnabledSkills(ids: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of ids) {
        if (seen.has(id) || !isSkillAvailable(id)) continue;
        seen.add(id);
        result.push(id);
    }
    return result;
}

function availableInfo(
    id: string,
    body: SkillBody,
    source: SkillSource,
    catalogEntry: SkillEntry | undefined,
): SkillInfo {
    const frontmatter = body.frontmatter;
    const name =
        typeof frontmatter.name === "string" && frontmatter.name.trim()
            ? frontmatter.name.trim()
            : (catalogEntry?.name ?? id);
    const description = summarizeSkillBody(body) ?? catalogEntry?.note ?? `Skill ${id}`;
    const category =
        typeof frontmatter.category === "string" && frontmatter.category.trim()
            ? frontmatter.category.trim()
            : (catalogEntry?.category ?? "custom");
    const triggers = normalizeTriggers(
        frontmatter.triggers ?? frontmatter.tags,
        id,
        name,
        source === "builtin" ? (catalogEntry?.triggers ?? []) : [],
    );
    const contextTokens = normalizeTokens(
        frontmatter.contextTokens,
        catalogEntry?.contextTokens,
        body.body,
    );

    return {
        id,
        name,
        description,
        category,
        triggers,
        contextTokens,
        source,
        availability: "available",
        path: body.fullPath,
        reason: null,
    };
}

function unavailable(
    id: string,
    availability: SkillAvailability,
    source: SkillSource,
    reason: string,
): SkillInfo {
    const entry = getSkill(id);
    return {
        id,
        name: entry?.name ?? id,
        description: entry?.note ?? id,
        category: entry?.category ?? "custom",
        triggers: [],
        contextTokens: entry?.contextTokens ?? 0,
        source,
        availability,
        path: null,
        reason,
    };
}

function readSkillFile(id: string, path: string): SkillBody | null {
    if (!existsSync(path)) return null;
    try {
        if (statSync(path).size === 0) return null;
    } catch {
        return null;
    }

    let raw: string;
    try {
        raw = readFileSync(path, "utf8");
    } catch {
        return null;
    }
    if (raw.trim() === "") return null;

    try {
        const { frontmatter, body } = parseSkillFrontmatter(raw);
        return { id, frontmatter, body, fullPath: path };
    } catch {
        return { id, frontmatter: {}, body: raw, fullPath: path };
    }
}

function normalizeTriggers(
    value: unknown,
    id: string,
    name: string,
    catalogTriggers: string[] = [],
): string[] {
    const triggers: string[] = [...catalogTriggers];

    if (Array.isArray(value)) {
        for (const item of value) {
            if (typeof item === "string" && item.trim()) triggers.push(item.trim());
        }
    }

    if (triggers.length === 0) {
        if (name.toLowerCase() !== id.toLowerCase()) triggers.push(name.toLowerCase());
        for (const token of id.toLowerCase().split(/[-_.]+/)) {
            if (token.length >= 3) triggers.push(token);
        }
        triggers.push(id.toLowerCase());
    }

    // De-duplicate case-insensitively while preserving the first spelling.
    const seen = new Set<string>();
    return triggers.filter((trigger) => {
        const key = trigger.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function normalizeTokens(
    frontmatterValue: unknown,
    catalogValue: number | undefined,
    body: string,
): number {
    const fromFrontmatter = Number(frontmatterValue);
    if (Number.isFinite(fromFrontmatter) && fromFrontmatter > 0) {
        return Math.round(fromFrontmatter);
    }
    if (typeof catalogValue === "number" && catalogValue > 0) {
        return catalogValue;
    }
    return Math.min(Math.max(Math.ceil(body.length / 4), 200), 20_000);
}
