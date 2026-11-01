import { checkbox, input, select } from "@inquirer/prompts";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import type { AgentSession } from "../agent/session.js";
import { catalog } from "../config/catalog.js";
import { readAppConfig, writeAppConfig } from "../config/app-config.js";
import {
    printFailure,
    printHint,
    printNotice,
    printSuccess,
    printWarning,
} from "../ui/messages.js";
import { getUserSkillsDir, isValidSkillId } from "../skills/loader.js";
import {
    availableEnabledSkills,
    getSkillInfo,
    listSkillInfos,
} from "../skills/registry.js";

const FETCH_TIMEOUT_MS = 20_000;

export async function runSkillsCommand(_session: AgentSession): Promise<void> {
    const current = readAppConfig();
    const enabled = availableEnabledSkills(current.skills ?? []);

    printNotice(`Currently enabled skills: ${enabled.length === 0 ? "none" : enabled.join(", ")}`);

    const choice = await select({
        message: "What do you want to do?",
        choices: [
            { name: "Enable / disable skills", value: "manage" },
            { name: "View known skills", value: "view" },
            { name: "Add a skill from GitHub", value: "add" },
            { name: "Install an on-demand catalog skill", value: "fetch" },
            { name: "Reset to no skills", value: "reset" },
            { name: "Cancel", value: "cancel" },
        ],
    });

    if (choice === "cancel") {
        return;
    }

    if (choice === "view") {
        printKnownSkills();
        return;
    }

    if (choice === "reset") {
        await writeAppConfig({ skills: [] });
        printSuccess("All skills disabled.");
        return;
    }

    if (choice === "add") {
        await addCustomSkill(enabled);
        return;
    }

    if (choice === "fetch") {
        await fetchSkillPrompt(enabled);
        return;
    }

    await manageSkills(enabled);
}

export async function runSkillsAdd(githubTreeUrl: string): Promise<void> {
    const match = githubTreeUrl.match(
        /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/,
    );
    if (!match) {
        printFailure(
            "Invalid GitHub tree URL. Expected: https://github.com/owner/repo/tree/branch/path/to/skill",
        );
        return;
    }

    const [, owner, repo, branch, skillPath] = match;
    const skillName = skillPath.split("/").pop();
    if (!skillName || !isSafeRepoPath(skillPath)) {
        printFailure("URL must point to a skill folder (e.g. .../tree/main/skills/my-skill)");
        return;
    }
    if (!isValidSkillId(skillName)) {
        printFailure(
            `Skill folder '${skillName}' is not a valid skill id. Use letters, digits, dots, dashes, or underscores.`,
        );
        return;
    }

    // A branch name is a single ref or path-like name; reject traversal and
    // backslashes so it cannot escape the URL path we construct.
    if (!isSafeRef(branch)) {
        printFailure("The GitHub branch in that URL is not valid.");
        return;
    }

    printNotice(`Fetching ${skillName} from ${owner}/${repo}...`);

    try {
        await downloadSkill(owner, repo, branch, skillPath, skillName);
        await enableSkill(skillName);
        const info = getSkillInfo(skillName);
        if (info.availability !== "available") {
            printFailure(info.reason ?? `Skill '${skillName}' was downloaded but cannot be loaded.`);
            return;
        }
        printSuccess(
            `Skill '${skillName}' installed in ${info.path ? dirname(info.path) : getUserSkillsDir()}`,
        );
        printHint("It is enabled for this session.");
    } catch (error) {
        printFailure(`Could not fetch ${skillName}: ${describeError(error)}`);
        printHint(
            `Paste a GitHub folder URL with /skills add <url>, or place SKILL.md in ${join(getUserSkillsDir(), skillName)}.`,
        );
    }
}

export async function runSkillsFetch(skillName: string): Promise<void> {
    const info = getSkillInfo(skillName);

    if (info.availability === "available") {
        await enableSkill(skillName);
        printNotice(`Skill '${skillName}' is already installed; enabled it instead of downloading again.`);
        return;
    }

    if (info.availability === "unverified") {
        printFailure(info.reason ?? `Skill '${skillName}' is not available in this build.`);
        printHint("Choose a verified skill with /skills, or install your own copy under ~/.node-cli/skills.");
        return;
    }

    const skill = catalog.skills[skillName];
    if (!skill || !skill.sourceUrl) {
        printFailure(`Skill '${skillName}' is not installed and has no catalog source URL.`);
        printHint("Run /skills add <github-tree-url> to add a skill from a GitHub tree URL.");
        return;
    }

    printNotice(`Fetching ${skillName} from ${skill.sourceUrl}...`);

    try {
        const match = skill.sourceUrl.match(
            /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.+)$/,
        );
        if (!match) {
            printFailure(`Could not parse the catalog source URL for ${skillName}`);
            return;
        }

        const [, owner, repo, branch, skillPath] = match;
        if (!isSafeRef(branch) || !isSafeRepoPath(skillPath)) {
            printFailure(`The catalog source URL for ${skillName} is not safe to fetch.`);
            return;
        }

        await downloadSkill(owner, repo, branch, skillPath, skillName);
        await enableSkill(skillName);
        const installed = getSkillInfo(skillName);
        if (installed.availability !== "available") {
            printFailure(installed.reason ?? `Skill '${skillName}' was downloaded but cannot be loaded.`);
            return;
        }
        printSuccess(`Skill '${skillName}' installed from ${skill.sourceUrl}`);
        printHint("It is enabled for this session.");
    } catch (error) {
        printFailure(`Could not fetch ${skillName}: ${describeError(error)}`);
        printHint(`Place SKILL.md in ${join(getUserSkillsDir(), skillName)} to install it manually.`);
    }
}

async function enableSkill(skillName: string): Promise<void> {
    const current = readAppConfig().skills ?? [];
    if (current.includes(skillName)) return;
    await writeAppConfig({ skills: [...current, skillName] });
}

async function downloadSkill(
    owner: string,
    repo: string,
    branch: string,
    skillPath: string,
    skillName: string,
): Promise<void> {
    const encodedPath = skillPath.split("/").map(encodeURIComponent).join("/");
    const rawBase = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encodedPath}`;
    const skillMd = await fetchRaw(`${rawBase}/SKILL.md`);
    if (!skillMd) {
        throw new Error(`SKILL.md was not found at ${skillName}`);
    }

    const targetDir = join(getUserSkillsDir(), skillName);
    mkdirSync(targetDir, { recursive: true });
    writeFileSync(join(targetDir, "SKILL.md"), skillMd);

    const license = await fetchRaw(`${rawBase}/LICENSE.txt`);
    if (license) {
        writeFileSync(join(targetDir, "LICENSE.txt"), license);
    }

    for (const directory of ["agents", "assets", "scripts", "references"]) {
        await downloadDir(
            owner,
            repo,
            branch,
            `${skillPath}/${directory}`,
            join(targetDir, directory),
        );
    }
}

async function fetchRaw(url: string): Promise<string | null> {
    try {
        const response = await fetch(url, {
            headers: { "user-agent": "node-cli" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return null;
        const text = await response.text();
        return text.trim() || null;
    } catch {
        return null;
    }
}

async function downloadDir(
    owner: string,
    repo: string,
    branch: string,
    srcPath: string,
    destDir: string,
): Promise<void> {
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;

    let tree: { tree?: { path?: string; type?: string }[] };
    try {
        const response = await fetch(apiUrl, {
            headers: { "user-agent": "node-cli", accept: "application/vnd.github+json" },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) return;
        tree = (await response.json()) as typeof tree;
    } catch {
        return;
    }

    const files = (tree.tree ?? []).filter(
        (file) =>
            typeof file.path === "string" &&
            file.type === "blob" &&
            file.path.startsWith(`${srcPath}/`),
    );

    for (const file of files) {
        const relative = file.path!.slice(srcPath.length + 1);
        if (!isSafeRepoPath(relative)) continue;

        const outPath = resolve(destDir, relative);
        if (outPath !== destDir && !outPath.startsWith(`${resolve(destDir)}${sep}`)) continue;

        const encoded = file.path!.split("/").map(encodeURIComponent).join("/");
        const content = await fetchRaw(
            `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${encoded}`,
        );
        if (!content) continue;

        mkdirSync(dirname(outPath), { recursive: true });
        writeFileSync(outPath, content);
    }
}

function isSafeRef(ref: string): boolean {
    return (
        ref.length > 0 &&
        ref.length <= 200 &&
        !ref.startsWith("/") &&
        !ref.startsWith("-") &&
        !ref.includes("\\") &&
        !ref.includes("..") &&
        !/\s/.test(ref)
    );
}

function isSafeRepoPath(path: string): boolean {
    if (!path || path.startsWith("/") || path.includes("\\") || path.includes("..")) {
        return false;
    }
    return path.split("/").every((part) => part !== "" && part !== ".");
}

function describeError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function addCustomSkill(current: string[]): Promise<void> {
    const id = await input({ message: "Enter the skill id (for example my-skill):" });
    if (!id || !id.trim()) {
        printFailure("No skill name entered.");
        return;
    }
    const trimmed = id.trim();
    if (!isValidSkillId(trimmed)) {
        printFailure(
            "A skill id may contain letters, digits, dots, dashes, and underscores only; path separators are not allowed.",
        );
        return;
    }
    if (current.includes(trimmed)) {
        printFailure(`Skill '${trimmed}' is already enabled.`);
        return;
    }

    await writeAppConfig({ skills: [...current, trimmed] });

    if (getSkillInfo(trimmed).availability === "available") {
        printSuccess(`Skill '${trimmed}' enabled.`);
    } else {
        printWarning(
            `Skill '${trimmed}' is enabled in your config, but no loadable SKILL.md was found. It will be ignored until installed.`,
        );
        printHint(`Expected: ${join(getUserSkillsDir(), trimmed, "SKILL.md")}`);
    }
    printHint("Changes apply to the next message.");
}

async function fetchSkillPrompt(enabled: string[]): Promise<void> {
    const available = listSkillInfos()
        .filter(
            (info) =>
                info.availability === "missing" &&
                catalog.skills[info.id]?.install === "on-demand" &&
                Boolean(catalog.skills[info.id]?.sourceUrl),
        )
        .map((info) => ({
            name: `${info.id} — ${info.description}`,
            value: info.id,
        }));

    if (available.length === 0) {
        printNotice("No on-demand catalog skills are available to install.");
        printHint("Use 'Add a skill from GitHub' for anything not in this list.");
        return;
    }

    const chosen = await select({
        message: "Select a skill to install",
        choices: available,
    });

    if (!chosen || enabled.includes(chosen)) return;

    await runSkillsFetch(chosen);
}

async function manageSkills(enabled: string[]): Promise<void> {
    const available = listSkillInfos().filter((info) => info.availability === "available");

    if (available.length === 0) {
        printFailure("No usable skills were found in this installation.");
        return;
    }

    const skipped = enabled.filter((id) => !available.some((info) => info.id === id));
    if (skipped.length > 0) {
        printWarning(`These enabled skills cannot be used and will be dropped: ${skipped.join(", ")}`);
    }

    const selected = await checkbox({
        message: "Select the skills to enable",
        choices: available.map((info) => ({
            name: `${info.id} — ${info.description}`,
            value: info.id,
            checked: enabled.includes(info.id),
        })),
    });

    await writeAppConfig({ skills: selected });
    printSuccess(
        selected.length === 0 ? "All skills disabled." : `Enabled skills: ${selected.join(", ")}`,
    );
    printHint("Changes apply to the next message.");
}

export function getEnabledSkills(): string[] {
    return availableEnabledSkills(readAppConfig().skills ?? []);
}

export function skillStatusLine(): string {
    const configured = readAppConfig().skills ?? [];
    const enabled = availableEnabledSkills(configured);
    const unavailable = configured.filter((id) => !enabled.includes(id));

    if (configured.length === 0) {
        return "Skills: none enabled";
    }

    const base = `Skills: ${enabled.length === 0 ? "none" : enabled.join(", ")} enabled`;
    return unavailable.length === 0
        ? base
        : `${base}; ignoring unavailable: ${unavailable.join(", ")}`;
}

function printKnownSkills(): void {
    const infos = listSkillInfos();
    const usable = infos.filter((info) => info.availability === "available");
    const unusable = infos.filter((info) => info.availability !== "available");

    const byCategory = new Map<string, typeof usable>();
    for (const info of usable) {
        const group = byCategory.get(info.category) ?? [];
        group.push(info);
        byCategory.set(info.category, group);
    }

    for (const [category, skills] of [...byCategory.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
    )) {
        const label = catalog.categories[category]?.label ?? category;
        printNotice(`${label}:`);
        for (const skill of skills) {
            const source = skill.source === "user" ? " [user]" : "";
            printHint(
                `  ${skill.id}${source} — ${skill.description} (~${skill.contextTokens} tokens)`,
            );
        }
    }

    if (unusable.length > 0) {
        printWarning("Unavailable in this build:");
        for (const skill of unusable) {
            printHint(`  ${skill.id} — ${skill.reason ?? skill.availability}`);
        }
    }

    printHint("Use 'Add a skill from GitHub' for skills not in this list.");
}
