import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { searchImages, formatImageResults, listImageProviders, getConfiguredProviders } from "./search.js";
import { downloadImage } from "./download.js";
import { printNotice } from "../ui/messages.js";

export function createImageMcpServer() {
    return createSdkMcpServer({
        name: "node-cli-images",
        version: "1.0.0",
        tools: [
            tool(
                "ImageSearch",
                "Search for royalty-free images from configured providers (Unsplash, Pixabay, Pexels). Returns concise metadata, preview URLs, photographer, source, license, and attribution. Use specific, design-relevant queries.",
                {
                    query: z.string().min(1),
                    orientation: z.enum(["landscape", "portrait", "square", "any"]).optional(),
                    category: z.string().optional(),
                    page: z.number().int().positive().optional(),
                    perPage: z.number().int().min(1).max(20).optional(),
                    provider: z.string().optional(),
                },
                async ({ query, orientation, category, page, perPage, provider }) => {
                    const q = category ? `${query} ${category}` : query;
                    const resp = await searchImages({ query: q, orientation, page, perPage }, provider);
                    printNotice(`ImageSearch: "${query}" -> ${resp.results.length} results (${resp.provider})`);
                    return {
                        content: [{ type: "text" as const, text: formatImageResults(resp) }],
                        isError: !!resp.error,
                    };
                },
            ),
            tool(
                "ImageProviders",
                "List configured image providers and their credential status.",
                {},
                async () => {
                    const all = listImageProviders();
                    const lines = all.map((p) => `${p.id}: ${p.isConfigured() ? "configured" : "NOT configured (set " + p.id.toUpperCase() + "_API_KEY or UNSPLASH_ACCESS_KEY)"}`);
                    return { content: [{ type: "text" as const, text: lines.join("\n") }] };
                },
            ),
            tool(
                "ImageDownload",
                "Download a selected image from a search result into the project's assets directory. " +
                    "Use the downloadUrl from an ImageSearch result. Saves the file locally and returns the local path. " +
                    "Pixabay images must be downloaded before use in a website (no permanent hotlinking).",
                {
                    downloadUrl: z.string().url(),
                    targetDir: z.string().min(1),
                },
                async ({ downloadUrl, targetDir }) => {
                    const result = await downloadImage(
                        {
                            id: "download",
                            provider: "unknown",
                            title: "downloaded image",
                            description: "",
                            url: downloadUrl,
                            downloadUrl,
                            width: 0,
                            height: 0,
                            photographer: "Unknown",
                            photographerUrl: "",
                            sourceUrl: "",
                            license: "",
                            attribution: "",
                            tags: [],
                        },
                        targetDir,
                    );
                    if (!result.ok) {
                        printNotice(`ImageDownload: failed - ${result.error}`);
                        return {
                            content: [{ type: "text" as const, text: `Image download failed: ${result.error}` }],
                            isError: true,
                        };
                    }
                    printNotice(`ImageDownload: saved to ${result.localPath}`);
                    const lines = [`Downloaded: ${result.localPath}`];
                    if (result.metadata?.attribution) lines.push(`Attribution: ${result.metadata.attribution}`);
                    return {
                        content: [{ type: "text" as const, text: lines.join("\\n") }],
                    };
                },
            ),
        ],
    });
}
