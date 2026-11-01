import { chatModels, findKnown, KNOWN_MODELS, type KnownModel } from "../config/free-models.js";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

export type FreeModelInfo = {
    id: string;
    name: string;
    contextLength?: number;
    pricing?: { prompt: number; completion: number };
};

export type ModelPickerEntry = {
    name: string;
    value: string;
    disabled?: boolean;
    description?: string;
};

export async function fetchFreeModels(): Promise<FreeModelInfo[]> {
    const response = await fetch(OPENROUTER_MODELS_URL);
    if (!response.ok) {
        throw new Error(`OpenRouter models request failed: ${response.status}`);
    }

    const data = (await response.json()) as { data: unknown[] };
    const models = (data.data ?? []) as Record<string, unknown>[];

    return models
        .map(normalizeModel)
        .filter((model) => isFree(model));
}

function normalizeModel(model: Record<string, unknown>): FreeModelInfo {
    const id = String(model["id"] ?? "");
    const name = String(model["name"] ?? id);
    const pricing = model["pricing"] as
        | { prompt: unknown; completion: unknown }
        | undefined;
    const rawContext = model["context_length"];
    const contextLength = typeof rawContext === "number" ? rawContext : undefined;

    return {
        id,
        name,
        contextLength: typeof contextLength === "number" ? contextLength : undefined,
        pricing: pricing
            ? {
                  prompt: Number(pricing.prompt) || 0,
                  completion: Number(pricing.completion) || 0,
              }
            : undefined,
    };
}

function isFree(model: FreeModelInfo): boolean {
    if (model.id.endsWith(":free")) {
        return true;
    }
    return (
        model.pricing?.prompt === 0 && model.pricing?.completion === 0
    );
}

function matchKnown(apiId: string, apiName: string): KnownModel | undefined {
    const idLower = apiId.toLowerCase();
    let best: KnownModel | undefined;
    let bestSlugLen = 0;

    for (const known of KNOWN_MODELS) {
        for (const slug of known.slugs) {
            const slugLower = slug.toLowerCase();
            if (idLower.includes(slugLower) && slugLower.length > bestSlugLen) {
                best = known;
                bestSlugLen = slugLower.length;
            }
        }
    }

    return best;
}

export function buildChatPickerEntries(apiModels: FreeModelInfo[]): ModelPickerEntry[] {
    const knownChat = chatModels();
    const matchedApiIds = new Set<string>();
    const entries: ModelPickerEntry[] = [];

    for (const known of knownChat) {
        const match = apiModels.find((model) => {
            const knownMatch = matchKnown(model.id, model.name);
            return knownMatch?.key === known.key;
        });
        if (match) {
            matchedApiIds.add(match.id);
            entries.push(entryForKnown(known, match.id, false));
        } else {
            entries.push(entryForKnown(known, "", true));
        }
    }

    for (const model of apiModels) {
        if (matchedApiIds.has(model.id)) {
            continue;
        }
        if (matchKnown(model.id, model.name)) {
            continue;
        }
        entries.push({
            name: `${model.id} (new)`,
            value: model.id,
            description: "Free model returned by OpenRouter, not in the known list",
        });
    }

    return entries;
}

function entryForKnown(
    known: KnownModel,
    apiId: string,
    disabled: boolean,
): ModelPickerEntry {
    const parts = [known.name];
    if (known.contextTokens) {
        parts.push(`${(known.contextTokens / 1000).toFixed(0)}K ctx`);
    }
    if (known.deprecatedSince) {
        parts.push(`deprecating ${known.deprecatedSince}`);
    }

    return {
        name: disabled ? `${parts.join(" · ")} (unavailable)` : parts.join(" · "),
        value: apiId,
        disabled,
    };
}