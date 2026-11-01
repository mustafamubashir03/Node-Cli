import { UnsplashProvider } from "./providers/unsplash.js";
import { PixabayProvider } from "./providers/pixabay.js";
import { PexelsProvider } from "./providers/pexels.js";
import type { ImageProvider, ImageResult, ImageSearchQuery, ImageSearchResponse } from "./types.js";

const providers: ImageProvider[] = [new UnsplashProvider(), new PixabayProvider(), new PexelsProvider()];

export function listImageProviders(): ImageProvider[] {
    return providers;
}

export function getConfiguredProviders(): ImageProvider[] {
    return providers.filter((p) => p.isConfigured());
}

export async function searchImages(q: ImageSearchQuery, preferredProvider?: string): Promise<ImageSearchResponse> {
    const configured = getConfiguredProviders();
    if (configured.length === 0) {
        return {
            provider: "none",
            query: q.query,
            page: q.page ?? 1,
            perPage: q.perPage ?? 10,
            total: 0,
            results: [],
            error: "No image provider configured. Set UNSPLASH_ACCESS_KEY, PIXABAY_API_KEY, or PEXELS_API_KEY in your environment.",
        };
    }

    let provider: ImageProvider | undefined;
    if (preferredProvider) {
        provider = configured.find((p) => p.id === preferredProvider);
    }
    if (!provider) provider = configured[0];

    // Dedup cache (simple in-memory, per-process)
    const cacheKey = `${provider.id}:${q.query}:${q.orientation ?? "any"}:${q.page ?? 1}:${q.perPage ?? 10}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const result = await provider.search(q);
    cache.set(cacheKey, result);
    return result;
}

const cache = new Map<string, ImageSearchResponse>();

export function clearImageCache(): void {
    cache.clear();
}

export function formatImageResults(resp: ImageSearchResponse): string {
    if (resp.error) return `Image search error (${resp.provider}): ${resp.error}`;
    if (resp.results.length === 0) return `No images found for "${resp.query}" via ${resp.provider}.`;
    const lines: string[] = [`Image search: "${resp.query}" via ${resp.provider} (${resp.results.length} results)`];
    for (const r of resp.results) {
        lines.push(`- [${r.id}] ${r.title} (${r.width}x${r.height}) by ${r.photographer}`);
        lines.push(`  url: ${r.url}`);
        lines.push(`  source: ${r.sourceUrl}`);
        lines.push(`  license: ${r.license}`);
        lines.push(`  attribution: ${r.attribution}`);
    }
    return lines.join("\n");
}
