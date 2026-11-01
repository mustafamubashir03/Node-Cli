export type KnownModel = {
    key: string;
    name: string;
    category: "chat" | "non-chat";
    contextTokens?: number;
    deprecatedSince?: string;
    nonChatType?: "moderation" | "embeddings" | "rerank" | "speech";
    slugs: string[];
};

export const KNOWN_MODELS: KnownModel[] = [
    {
        key: "nvidia-nemotron-3-5-lightning",
        name: "NVIDIA Nemotron 3.5 Lightning",
        category: "chat",
        contextTokens: 1_000_000,
        slugs: ["nemotron-3.5-lightning", "nemotron-35-lightning"],
    },
    {
        key: "nvidia-nemotron-3-ultra",
        name: "NVIDIA Nemotron 3 Ultra",
        category: "chat",
        contextTokens: 1_000_000,
        slugs: ["nemotron-3-ultra", "nemotron-3-ultra-"],
    },
    {
        key: "nvidia-nemotron-3-super",
        name: "NVIDIA Nemotron 3 Super",
        category: "chat",
        contextTokens: 262_000,
        slugs: ["nemotron-3-super", "nemotron-3-super-"],
    },
    {
        key: "nvidia-nemotron-3-nano-omni",
        name: "NVIDIA Nemotron 3 Nano Omni",
        category: "chat",
        contextTokens: 256_000,
        slugs: ["nemotron-3-nano-omni", "nemotron-nano-omni"],
    },
    {
        key: "thinking-machines-inkling",
        name: "Thinking Machines Inkling",
        category: "chat",
        contextTokens: 1_050_000,
        slugs: ["inkling"],
    },
    {
        key: "thinking-machines-inkling-small",
        name: "Thinking Machines Inkling Small",
        category: "chat",
        contextTokens: 1_050_000,
        slugs: ["inkling-small"],
    },
    {
        key: "poolside-laguna-s-2-1",
        name: "Poolside Laguna S 2.1",
        category: "chat",
        contextTokens: 262_000,
        deprecatedSince: "Oct 31, 2026",
        slugs: ["poolside/laguna-s-2.1", "laguna-s-2.1"],
    },
    {
        key: "poolside-laguna-xs-2-1",
        name: "Poolside Laguna XS 2.1",
        category: "chat",
        contextTokens: 262_000,
        deprecatedSince: "Oct 31, 2026",
        slugs: ["poolside/laguna-xs-2.1", "laguna-xs-2.1"],
    },
    {
        key: "cohere-north-mini-code",
        name: "Cohere North Mini Code",
        category: "chat",
        contextTokens: 256_000,
        slugs: ["north-mini", "north-mini-code"],
    },
    {
        key: "google-gemma-4-26b-a4b",
        name: "Google Gemma 4 26B A4B",
        category: "chat",
        contextTokens: 262_000,
        slugs: ["gemma-4-26b", "gemma-4-26b-a4b"],
    },
    {
        key: "google-gemma-4-31b",
        name: "Google Gemma 4 31B",
        category: "chat",
        contextTokens: 262_000,
        slugs: ["gemma-4-31b"],
    },
    {
        key: "nvidia-nemotron-3-5-content-safety",
        name: "NVIDIA Nemotron 3.5 Content Safety",
        category: "non-chat",
        nonChatType: "moderation",
        slugs: ["content-safety", "content_safety"],
    },
    {
        key: "nvidia-nemotron-3-embed-1b",
        name: "NVIDIA Nemotron 3 Embed 1B",
        category: "non-chat",
        nonChatType: "embeddings",
        slugs: ["nemotron-3-embed-1b", "embed-1b"],
    },
    {
        key: "nvidia-llama-nemotron-embed-vl-1b-v2",
        name: "NVIDIA Llama Nemotron Embed VL 1B V2",
        category: "non-chat",
        nonChatType: "embeddings",
        slugs: ["embed-vl", "embed-vl-1b-v2"],
    },
    {
        key: "nvidia-llama-nemotron-rerank-vl-1b-v2",
        name: "NVIDIA Llama Nemotron Rerank VL 1B V2",
        category: "non-chat",
        nonChatType: "rerank",
        slugs: ["rerank-vl", "rerank-vl-1b-v2"],
    },
    {
        key: "fish-audio-s2-1-pro-free",
        name: "Fish Audio S2.1 Pro Free",
        category: "non-chat",
        nonChatType: "speech",
        slugs: ["fish-audio", "s2.1-pro", "s2-1-pro"],
    },
];

export function findKnown(key: string): KnownModel | undefined {
    return KNOWN_MODELS.find((known) => known.key === key);
}

export function chatModels(): KnownModel[] {
    return KNOWN_MODELS.filter((known) => known.category === "chat");
}

export function nonChatModels(): KnownModel[] {
    return KNOWN_MODELS.filter((known) => known.category === "non-chat");
}