import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { getSkill } from "../config/catalog.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const SKILLS_ROOT = join(__dirname, "builtin");

export const USER_SKILLS_ENV = "NODE_CLI_SKILLS_DIR";

const SKILL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function getSkillsRoot(): string {
    return SKILLS_ROOT;
}

export function getBuiltinSkillsDir(): string {
    return SKILLS_ROOT;
}

/** Root for skills the user installed, kept outside the package install. */
export function getUserSkillsDir(): string {
    return process.env[USER_SKILLS_ENV] || join(homedir(), ".node-cli", "skills");
}

export function isValidSkillId(id: string): boolean {
    return (
        typeof id === "string" &&
        id.length > 0 &&
        id.length <= 128 &&
        SKILL_ID_PATTERN.test(id) &&
        !id.includes("..")
    );
}

/** Resolve the directory a skill is actually loaded from: user install wins. */
export function resolveSkillDir(id: string): string {
    if (isValidSkillId(id)) {
        const userDir = join(getUserSkillsDir(), id);
        if (existsSync(join(userDir, "SKILL.md"))) {
            return userDir;
        }
    }
    return join(SKILLS_ROOT, id);
}

export function resolveUserSkillDir(id: string): string {
    return join(getUserSkillsDir(), id);
}

export function resolveSkillPath(id: string): string {
    return join(resolveSkillDir(id), "SKILL.md");
}

export type SkillBody = {
    id: string;
    frontmatter: Record<string, unknown>;
    body: string;
    fullPath: string;
};

/**
 * Loads a skill from the user install directory first, then from the bundled
 * release directory. Availability policy lives in `registry.ts`; this function
 * only answers "is there readable skill content at this id".
 */
export function loadSkillBody(id: string): SkillBody | null {
    if (!isValidSkillId(id)) return null;

    const skillPath = resolveSkillPath(id);
    if (!existsSync(skillPath)) return null;

    let raw: string;
    try {
        raw = readFileSync(skillPath, "utf8");
    } catch {
        return null;
    }
    if (raw.trim() === "") return null;

    let frontmatter: Record<string, unknown>;
    let body: string;
    try {
        ({ frontmatter, body } = parseSkillFrontmatter(raw));
    } catch {
        frontmatter = {};
        body = raw;
    }

    return {
        id,
        frontmatter,
        body,
        fullPath: skillPath,
    };
}

export function loadSkillIndex(
    ids: string[],
): { id: string; name: string; description: string; contextTokens: number }[] {
    const index: { id: string; name: string; description: string; contextTokens: number }[] = [];
    for (const id of ids) {
        const skill = getSkill(id);
        const body = loadSkillBody(id);
        if (!skill || !body) continue;
        index.push({
            id,
            name: skill.name,
            description: summarizeSkillBody(body) ?? skill.name,
            contextTokens: skill.contextTokens ?? 300,
        });
    }
    return index;
}

export function skillFileExists(id: string): boolean {
    if (!isValidSkillId(id)) return false;
    return (
        existsSync(join(getUserSkillsDir(), id, "SKILL.md")) ||
        existsSync(join(SKILLS_ROOT, id, "SKILL.md"))
    );
}

export function listInstalledSkills(): string[] {
    const ids = new Set<string>();
    for (const root of [getUserSkillsDir(), SKILLS_ROOT]) {
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory() || !isValidSkillId(entry.name)) continue;
            if (existsSync(join(root, entry.name, "SKILL.md"))) {
                ids.add(entry.name);
            }
        }
    }
    return [...ids].sort();
}

export type SkillReleaseStatus = "verified" | "unverified" | "unknown";

export function loadSkillReleaseManifest(): Record<
    string,
    { commitSha?: string | null; verified?: boolean }
> {
    const candidates = [join(SKILLS_ROOT, "..", "..", "config", "skills.lock.json")];
    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            try {
                const parsed = JSON.parse(readFileSync(candidate, "utf8")) as {
                    skills?: Record<string, any>;
                };
                return parsed.skills || {};
            } catch {
                return {};
            }
        }
    }
    return {};
}

export function getSkillReleaseStatus(id: string): SkillReleaseStatus {
    const manifest = loadSkillReleaseManifest();
    const entry = manifest[id];
    if (!entry) return "unknown";
    if (entry.verified === true) return "verified";
    if (entry.commitSha) return "verified";
    return "unverified";
}

export function isSkillDistributable(id: string): boolean {
    return getSkillReleaseStatus(id) === "verified";
}

/** First meaningful heading or paragraph in a skill body, for the prompt index. */
export function summarizeSkillBody(skill: { body: string; frontmatter: Record<string, unknown> }): string | null {
    const described = skill.frontmatter.description;
    if (typeof described === "string" && described.trim()) {
        return described.trim();
    }

    for (const rawLine of skill.body.split("\n")) {
        const line = rawLine
            .trim()
            .replace(/^#+\s*/, "")
            .replace(/[*_`]/g, "");
        if (line.length >= 8 && !/^---$/.test(line)) {
            return line.length <= 160 ? line : `${line.slice(0, 157)}...`;
        }
    }
    return null;
}

export function parseSkillFrontmatter(raw: string): {
    frontmatter: Record<string, unknown>;
    body: string;
} {
    if (!raw.startsWith("---\n") && !raw.startsWith("---\r\n")) {
        return { frontmatter: {}, body: raw };
    }

    const endIdx = raw.indexOf("\n---", 4);
    if (endIdx === -1) {
        return { frontmatter: {}, body: raw };
    }

    const fmRaw = raw.slice(raw.indexOf("\n") + 1, endIdx);
    const body = raw.slice(endIdx + 4).replace(/^\r?\n/, "");

    const frontmatter: Record<string, unknown> = {};
    for (const line of fmRaw.split(/\r?\n/)) {
        const colonIdx = line.indexOf(":");
        if (colonIdx === -1) continue;
        const key = line.slice(0, colonIdx).trim();
        let value: unknown = line.slice(colonIdx + 1).trim();
        if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
            const rawValue = value;
            try {
                value = JSON.parse(rawValue);
            } catch {
                value = rawValue
                    .slice(1, -1)
                    .split(",")
                    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
                    .filter(Boolean);
            }
        } else if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
            value = value.slice(1, -1);
        } else if (value === "true") {
            value = true;
        } else if (value === "false") {
            value = false;
        } else if (typeof value === "string" && value !== "" && !isNaN(Number(value))) {
            value = Number(value);
        }
        frontmatter[key] = value;
    }

    return { frontmatter, body };
}
