import type { FigmaUrl } from "./types.js";

/**
 * Parse a Figma URL into file key and node ID.
 *
 * Supported formats:
 * - https://www.figma.com/design/FILE_KEY/Name?node-id=123-456
 * - https://www.figma.com/file/FILE_KEY/Name?node-id=123-456
 * - https://www.figma.com/design/FILE_KEY/Name
 */
export function parseFigmaUrl(url: string): FigmaUrl | null {
  if (!url || typeof url !== "string") return null;

  // Normalize URL
  const trimmed = url.trim();

  // Match file key from URL path
  const fileMatch = trimmed.match(/figma\.com\/(?:design|file)\/([a-zA-Z0-9]+)/);
  if (!fileMatch) return null;

  const fileKey = fileMatch[1];

  // Match node ID from query params
  const nodeMatch = trimmed.match(/node-id=([0-9]+-[0-9]+)/);
  const nodeId = nodeMatch ? nodeMatch[1].replace("-", ":") : undefined;

  // Match page ID from query params (less common)
  const pageMatch = trimmed.match(/page-id=([0-9]+:[0-9]+)/);
  const pageId = pageMatch ? pageMatch[1] : undefined;

  return {
    fileKey,
    nodeId,
    pageId,
    url: trimmed,
  };
}

/**
 * Validate a Figma URL.
 */
export function validateFigmaUrl(url: string): { valid: boolean; error?: string; parsed?: FigmaUrl } {
  const parsed = parseFigmaUrl(url);
  if (!parsed) {
    return { valid: false, error: "Invalid Figma URL. Expected format: https://www.figma.com/design/FILE_KEY/Name?node-id=123-456" };
  }
  if (!parsed.fileKey || parsed.fileKey.length < 10) {
    return { valid: false, error: "Invalid file key in URL" };
  }
  return { valid: true, parsed };
}

/**
 * Convert node ID format (123:456) to URL format (123-456).
 */
export function nodeIdToUrlFormat(nodeId: string): string {
  return nodeId.replace(":", "-");
}

/**
 * Convert URL format (123-456) to API format (123:456).
 */
export function nodeIdToApiFormat(nodeId: string): string {
  return nodeId.replace("-", ":");
}