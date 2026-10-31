/**
 * Output lint: validates HTML content against the asset manifest.
 * Fails on:
 * - <img> or CSS url to reference/full.png
 * - <img> or CSS url to 1-2.png
 * - A path not in assets.json
 * - http(s) URLs
 */
export interface LintResult {
  valid: boolean;
  errors: string[];
}

export function lintOutput(html: string, assetPaths: string[]): LintResult {
  const errors: string[] = [];

  // Check for reference/full.png
  if (html.includes("reference/full.png") || html.includes("reference\\full.png")) {
    errors.push("Found reference/full.png in output");
  }

  // Check for 1-2.png
  if (html.includes("1-2.png")) {
    errors.push("Found 1-2.png (root frame screenshot) in output");
  }

  // Check for http(s) URLs in img src or css url
  const httpPattern = /https?:\/\/[^\s"'<>)]+/g;
  const httpMatches = html.match(httpPattern);
  if (httpMatches) {
    for (const m of httpMatches) {
      errors.push(`Found http(s) URL: ${m}`);
    }
  }

  // Check for paths not in assets.json
  // Extract src attributes and url() values
  const srcPattern = /src=["']([^"']+)["']/g;
  const urlPattern = /url\(["']?([^"')]+)["']?\)/g;

  let match;
  while ((match = srcPattern.exec(html)) !== null) {
    const path = match[1];
    if (path && !path.startsWith("data:") && !assetPaths.includes(path)) {
      errors.push(`Asset path not in manifest: ${path}`);
    }
  }
  while ((match = urlPattern.exec(html)) !== null) {
    const path = match[1];
    if (path && !path.startsWith("data:") && !assetPaths.includes(path)) {
      errors.push(`Asset path not in manifest: ${path}`);
    }
  }

  return { valid: errors.length === 0, errors };
}