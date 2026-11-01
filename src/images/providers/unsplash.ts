import type { ImageProvider, ImageResult, ImageSearchQuery, ImageSearchResponse } from "../types.js";

const BASE = "https://api.unsplash.com";

export class UnsplashProvider implements ImageProvider {
    readonly id = "unsplash";
    readonly name = "Unsplash";

    isConfigured(): boolean {
        return !!process.env.UNSPLASH_ACCESS_KEY;
    }

    async search(q: ImageSearchQuery): Promise<ImageSearchResponse> {
        const key = process.env.UNSPLASH_ACCESS_KEY;
        if (!key) {
            return { provider: this.id, query: q.query, page: q.page ?? 1, perPage: q.perPage ?? 10, total: 0, results: [], error: "UNSPLASH_ACCESS_KEY is not set." };
        }
        const page = q.page ?? 1;
        const perPage = Math.min(q.perPage ?? 10, 30);
        const params = new URLSearchParams({ query: q.query, page: String(page), per_page: String(perPage) });
        if (q.orientation && q.orientation !== "any") params.set("orientation", q.orientation);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch(`${BASE}/search/photos?${params}`, {
                headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" },
                signal: controller.signal,
            });
            if (!res.ok) {
                return { provider: this.id, query: q.query, page, perPage, total: 0, results: [], error: `Unsplash HTTP ${res.status}: ${res.statusText}` };
            }
            const data = (await res.json()) as { total: number; results: any[] };
            const results: ImageResult[] = (data.results ?? []).map((r) => ({
                id: r.id,
                provider: this.id,
                title: r.alt_description || r.description || "Unsplash photo",
                description: r.description || r.alt_description || "",
                url: r.urls?.regular || r.urls?.small || r.urls?.thumb || "",
                downloadUrl: r.urls?.regular || r.urls?.full || "",
                width: r.width ?? 0,
                height: r.height ?? 0,
                photographer: r.user?.name ?? "Unknown",
                photographerUrl: r.user?.links?.html ?? "",
                sourceUrl: r.links?.html ?? "",
                license: "Unsplash License (free to use, attribution appreciated)",
                attribution: `Photo by ${r.user?.name ?? "Unknown"} on Unsplash (${r.links?.html ?? ""})`,
                tags: (r.tags ?? []).map((t: any) => t.title).filter(Boolean),
            }));
            return { provider: this.id, query: q.query, page, perPage, total: data.total ?? results.length, results };
        } catch (err) {
            return { provider: this.id, query: q.query, page, perPage, total: 0, results: [], error: `Unsplash request failed: ${err instanceof Error ? err.message : String(err)}` };
        } finally {
            clearTimeout(timeout);
        }
    }
}
