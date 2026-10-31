import type { ImageProvider, ImageResult, ImageSearchQuery, ImageSearchResponse } from "../types.js";

const BASE = "https://api.pexels.com/v1";

export class PexelsProvider implements ImageProvider {
    readonly id = "pexels";
    readonly name = "Pexels";

    isConfigured(): boolean {
        return !!process.env.PEXELS_API_KEY;
    }

    async search(q: ImageSearchQuery): Promise<ImageSearchResponse> {
        const key = process.env.PEXELS_API_KEY;
        if (!key) {
            return { provider: this.id, query: q.query, page: q.page ?? 1, perPage: q.perPage ?? 10, total: 0, results: [], error: "PEXELS_API_KEY is not set." };
        }
        const page = q.page ?? 1;
        const perPage = Math.min(q.perPage ?? 10, 80);
        const params = new URLSearchParams({ query: q.query, page: String(page), per_page: String(perPage) });
        if (q.orientation && q.orientation !== "any") params.set("orientation", q.orientation);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch(`${BASE}/search?${params}`, {
                headers: { Authorization: key },
                signal: controller.signal,
            });
            if (!res.ok) {
                return { provider: this.id, query: q.query, page, perPage, total: 0, results: [], error: `Pexels HTTP ${res.status}: ${res.statusText}` };
            }
            const data = (await res.json()) as { total_results: number; photos: any[] };
            const results: ImageResult[] = (data.photos ?? []).map((r) => ({
                id: String(r.id),
                provider: this.id,
                title: r.alt || "Pexels photo",
                description: r.alt || "",
                url: r.src?.large || r.src?.medium || r.src?.small || "",
                downloadUrl: r.src?.original || r.src?.large || "",
                width: r.width ?? 0,
                height: r.height ?? 0,
                photographer: r.photographer ?? "Unknown",
                photographerUrl: r.photographer_url ?? "",
                sourceUrl: r.url ?? "",
                license: "Pexels License (free to use, attribution appreciated)",
                attribution: `Photo by ${r.photographer} on Pexels (${r.url ?? ""})`,
                tags: [],
            }));
            return { provider: this.id, query: q.query, page, perPage, total: data.total_results ?? results.length, results };
        } catch (err) {
            return { provider: this.id, query: q.query, page, perPage, total: 0, results: [], error: `Pexels request failed: ${err instanceof Error ? err.message : String(err)}` };
        } finally {
            clearTimeout(timeout);
        }
    }
}
