import catalogJson from "./catalog.json" with { type: "json" };

export type ResourceKind =
    | "skill"
    | "design-intelligence"
    | "design-system-reference"
    | "design-token-spec"
    | "component-source"
    | "interaction"
    | "quality-review"
    | "workflow"
    | "workflow-reference"
    | "reference";

export type SkillEntry = {
    name: string;
    category: string;
    sourceRepo: string | null;
    sourceUrl: string | null;
    license: string | null;
    install: "vendored" | "on-demand" | "removed";
    note?: string;
    triggers: string[];
    contextTokens: number;
    resourceKind?: ResourceKind;
    sourceCommit?: string;
    dependencies?: string[];
    supportedStacks?: string[];
    verificationStatus?: "verified" | "unverified" | "cataloged" | "reference-only";
    payloadPaths?: string[];
};

export type PresetEntry = {
    label: string;
    description: string;
    skills: string[];
};

export type CategoryEntry = {
    label: string;
    description: string;
};

export type ConflictGroupEntry = {
    label: string;
    description: string;
    skills: string[];
    rule: "exactly-one" | "compatible";
};

export type Catalog = {
    version: number;
    categories: Record<string, CategoryEntry>;
    presets: Record<string, PresetEntry>;
    conflictGroups: Record<string, ConflictGroupEntry>;
    skills: Record<string, SkillEntry>;
};

export const catalog: Catalog = catalogJson as Catalog;

export function getSkill(id: string): SkillEntry | undefined {
    return catalog.skills[id];
}

export function getPreset(name: string): PresetEntry | undefined {
    return catalog.presets[name];
}

export function getCategory(name: string): CategoryEntry | undefined {
    return catalog.categories[name];
}

export function getConflictGroup(name: string): ConflictGroupEntry | undefined {
    return catalog.conflictGroups[name];
}

export function listSkills(): SkillEntry[] {
    return Object.values(catalog.skills);
}

export function listCategories(): string[] {
    return Object.keys(catalog.categories);
}

export function listPresets(): string[] {
    return Object.keys(catalog.presets);
}

export function expandPreset(presetName: string): string[] {
    const preset = catalog.presets[presetName];
    return preset ? [...preset.skills] : [];
}

export function getConflictGroups(): ConflictGroupEntry[] {
    return Object.values(catalog.conflictGroups);
}

export function checkConflicts(selected: string[]): { group: string; skills: string[]; message: string }[] {
    const issues: { group: string; skills: string[]; message: string }[] = [];
    const selectedSet = new Set(selected);

    for (const [groupName, group] of Object.entries(catalog.conflictGroups)) {
        const selectedInGroup = group.skills.filter((s) => selectedSet.has(s));
        if (group.rule === "exactly-one" && selectedInGroup.length > 1) {
            issues.push({
                group: groupName,
                skills: selectedInGroup,
                message: `Only one skill from "${group.label}" may be active at once: ${selectedInGroup.join(", ")}`,
            });
        }
    }

    return issues;
}