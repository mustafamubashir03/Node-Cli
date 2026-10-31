import type { ImageProvider, ImageResult, ImageSearchQuery, ImageSearchResponse } from "../types.js";

const BASE = "https://pixabay.com/api";

export class PixabayProvider implements ImageProvider {
    readonly id = "pixabay";
    readonly name = "Pixabay";

    isConfigured(): boolean {
        return !!process.env.PIXABAY_API_KEY;
    }

    async search(q: ImageSearchQuery): Promise<ImageSearchResponse> {
        const key = process.env.PIXABAY_API_KEY;
        if (!key) {
            return { provider: this.id, query: q.query, page: q.page ?? 1, perPage: q.perPage ?? 10, total: 0, results: [], error: "PIXABAY_API_KEY is not set." };
        }
        const page = q.page ?? 1;
        const perPage = Math.min(Math.max(q.perPage ?? 10, 3), 200);
        const params = new URLSearchParams({ key, q: q.query, image_type: "photo", page: String(page), per_page: String(perPage), safesearch: "true" });
        if (q.orientation && q.orientation !== "any") params.set("orientation", q.orientation);

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 15000);
        try {
            const res = await fetch(`${BASE}/?${params}`, { signal: controller.signal });
            if (!res.ok) {
                return { provider: this.id, query: q.query, page, perPage, total: 0, results: [], error: `Pixabay HTTP ${res.status}: ${res.statusText}` };
            }
            const data = (await res.json()) as { totalHits: number; hits: any[] };
            const results: ImageResult[] = (data.hits ?? []).map((r) => ({
                id: String(r.id),
                provider: this.id,
                title: r.tags || "Pixabay photo",
                description: r.tags || "",
                url: r.webformatURL || r.previewURL || "",
                downloadUrl: r.largeImageURL || r.webformatURL || "",
                width: r.imageWidth ?? 0,
                height: r.imageHeight ?? 0,
                photographer: r.user ?? "Unknown",
                photographerUrl: `https://pixabay.com/users/${r.user}-${r.user_id}/`,
                sourceUrl: r.pageURL || "",
                license: "Pixabay License (free for commercial use, no attribution required)",
                attribution: `Image by ${r.user} from Pixabay`,
                tags: (r.tags || "").split(",").map((t: string) => t.trim()).filter(Boolean),
            }));
            return { provider: this.id, query: q.query, page, perPage, total: data.totalHits ?? results.length, results };
        } catch (err) {
            return { provider: this.id, query: q.query, page, perPage, total: 0, results: [], error: `Pixabay request failed: ${err instanceof Error ? err.message : String(err)}` };
        } finally {
            clearTimeout(timeout);
        }
    }
}
