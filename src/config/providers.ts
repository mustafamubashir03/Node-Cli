export type Provider = {
    id: string;
    name: string;
    description: string;
    keyVariable: string;
    models: string[];
    exampleModel: string;
};

export const PROVIDERS: Provider[] = [
    {
        id: "openrouter",
        name: "OpenRouter",
        description: "One account, many models — including free ones",
        keyVariable: "OPENROUTER_API_KEY",
        models: [
            "poolside/laguna-s-2.1:free",
            "meta-llama/llama-3.1-8b-instruct:free",
            "google/gemma-2-9b-it:free",
            "microsoft/phi-3.5-mini-instruct:free",
        ],
        exampleModel: "poolside/laguna-s-2.1:free",
    },
];

export function findProvider(id: string): Provider | undefined {
    return PROVIDERS.find((provider) => provider.id === id);
}

export function defaultProvider(): Provider {
    return PROVIDERS[0];
}