export type ImageOrientation = "landscape" | "portrait" | "square" | "any";

export type ImageSearchQuery = {
    query: string;
    orientation?: ImageOrientation;
    category?: string;
    page?: number;
    perPage?: number;
    minWidth?: number;
    minHeight?: number;
};

export type ImageResult = {
    id: string;
    provider: string;
    title: string;
    description: string;
    url: string; // preview/display URL
    downloadUrl: string; // URL to fetch the asset (may equal url)
    width: number;
    height: number;
    photographer: string;
    photographerUrl: string;
    sourceUrl: string; // page on provider site
    license: string;
    attribution: string;
    tags: string[];
};

export type ImageSearchResponse = {
    provider: string;
    query: string;
    page: number;
    perPage: number;
    total: number;
    results: ImageResult[];
    error?: string;
};

export interface ImageProvider {
    readonly id: string;
    readonly name: string;
    isConfigured(): boolean;
    search(q: ImageSearchQuery): Promise<ImageSearchResponse>;
}
