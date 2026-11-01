import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { availableSkillIds, getSkillInfo, isSkillAvailable } from "../skills/registry.js";
import {
    DatasetError,
    isMode,
    type GoldenCase,
    type GoldenDataset,
    type LoadedDataset,
} from "./types.js";

export { DatasetError };

/**
 * Loads and validates a golden dataset. Validation is deliberately strict:
 * a mistyped skill id or an impossible combination (expected and forbidden at
 * once, or expecting none while listing expectations) is an authoring bug, not
 * a measurement result.
 */
export function loadDataset(path: string): LoadedDataset {
    let text: string;
    try {
        text = readFileSync(path, "utf8");
    } catch (error) {
        throw new DatasetError(`Cannot read dataset "${path}": ${errorText(error)}`);
    }

    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        throw new DatasetError(`Dataset "${path}" is not valid JSON: ${errorText(error)}`);
    }

    const dataset = parseDataset(raw);
    validateAgainstCatalog(dataset);

    return {
        dataset,
        path,
        sha256: createHash("sha256").update(text).digest("hex"),
    };
}

export function parseDataset(raw: unknown): GoldenDataset {
    if (!isRecord(raw)) throw new DatasetError("Dataset must be a JSON object.");

    if (!Number.isInteger(raw.version) || (raw.version as number) < 1) {
        throw new DatasetError("Dataset version must be a positive integer.");
    }
    if (typeof raw.selectionVersion !== "string" || !raw.selectionVersion.trim()) {
        throw new DatasetError("Dataset selectionVersion must be a non-empty string.");
    }
    if (typeof raw.description !== "string") {
        throw new DatasetError("Dataset description must be a string.");
    }
    if (!Array.isArray(raw.cases)) {
        throw new DatasetError("Dataset cases must be an array.");
    }

    const cases = raw.cases.map((value, index) => parseCase(value, index));
    const ids = new Set<string>();
    for (const item of cases) {
        if (ids.has(item.id)) throw new DatasetError(`Duplicate case id: "${item.id}".`);
        ids.add(item.id);
    }

    return {
        version: raw.version as number,
        selectionVersion: raw.selectionVersion,
        description: raw.description,
        cases,
    };
}

function parseCase(raw: unknown, index: number): GoldenCase {
    const where = `cases[${index}]`;
    if (!isRecord(raw)) throw new DatasetError(`${where} must be an object.`);

    const id = requireString(raw.id, `${where}.id`);
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
        throw new DatasetError(`${where}.id must be kebab-case, got "${id}".`);
    }

    const prompt = requireString(raw.prompt, `${where}.prompt`);

    const mode = raw.mode === undefined ? "agent" : raw.mode;
    if (!isMode(mode)) {
        throw new DatasetError(`${where}.mode must be one of agent, ask, plan, strict.`);
    }

    const enabledSkills = optionalStringArray(raw.enabledSkills, `${where}.enabledSkills`);
    const expectedAny = optionalStringArray(raw.expectedAny, `${where}.expectedAny`);
    const forbidden = optionalStringArray(raw.forbidden, `${where}.forbidden`);
    const tags = optionalStringArray(raw.tags, `${where}.tags`);
    const notes = raw.notes === undefined ? undefined : requireString(raw.notes, `${where}.notes`);
    const expectNone = raw.expectNone === undefined ? false : requireBoolean(raw.expectNone, `${where}.expectNone`);

    if (!expectNone && expectedAny.length === 0) {
        throw new DatasetError(`${where} must set expectedAny or expectNone: true.`);
    }
    if (expectNone && expectedAny.length > 0) {
        throw new DatasetError(`${where} cannot set both expectNone and expectedAny.`);
    }

    const overlap = expectedAny.filter((id) => forbidden.includes(id));
    if (overlap.length > 0) {
        throw new DatasetError(`${where} lists ${overlap.join(", ")} as both expected and forbidden.`);
    }

    if (enabledSkills.length > 0) {
        const outside = expectedAny.filter((id) => !enabledSkills.includes(id));
        if (outside.length > 0) {
            throw new DatasetError(
                `${where} expects ${outside.join(", ")} but does not enable those skills.`,
            );
        }
    }

    return {
        id,
        prompt,
        mode,
        enabledSkills,
        expectedAny,
        forbidden,
        expectNone,
        tags,
        notes,
    };
}

/** Every referenced id must exist in the catalog and be usable right now. */
export function validateAgainstCatalog(dataset: GoldenDataset): void {
    const available = new Set(availableSkillIds());
    const problems: string[] = [];

    for (const item of dataset.cases) {
        const referenced = [
            ...(item.enabledSkills ?? []),
            ...(item.expectedAny ?? []),
            ...(item.forbidden ?? []),
        ];
        for (const id of referenced) {
            const info = getSkillInfo(id);
            if (info.availability === "unknown") {
                problems.push(`${item.id}: unknown skill id "${id}"`);
            } else if (!isSkillAvailable(id)) {
                problems.push(`${item.id}: skill "${id}" is not available in this installation`);
            } else if (!available.has(id)) {
                problems.push(`${item.id}: skill "${id}" is not in the available set`);
            }
        }
    }

    if (problems.length > 0) {
        throw new DatasetError(`Dataset references unusable skills:\n- ${problems.join("\n- ")}`);
    }
}

function requireString(value: unknown, label: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw new DatasetError(`${label} must be a non-empty string.`);
    }
    return value;
}

function requireBoolean(value: unknown, label: string): boolean {
    if (typeof value !== "boolean") {
        throw new DatasetError(`${label} must be a boolean.`);
    }
    return value;
}

function optionalStringArray(value: unknown, label: string): string[] {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item.trim())) {
        throw new DatasetError(`${label} must be an array of non-empty strings.`);
    }
    return [...new Set(value as string[])];
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
