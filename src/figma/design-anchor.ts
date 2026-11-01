/**
 * Design-anchor system prompt builder.
 * Prepends a code-built design-anchor block to the system prompt every turn.
 * Also used on resume.
 */
export interface DesignAnchorInfo {
  packagePath: string;
  manifestHash: string;
  sections: { index: number; name: string; status: string; lastDiffPercent?: number }[];
  assetCounts: { total: number; pending: number; downloaded: number; failed: number };
  currentSectionSpec?: string;
}

export function buildDesignAnchor(info: DesignAnchorInfo): string {
  const lines: string[] = [];
  lines.push("=== DESIGN ANCHOR (auto-generated, do not modify) ===");
  lines.push(`Package: ${info.packagePath}`);
  lines.push(`Manifest hash: ${info.manifestHash}`);
  lines.push("");
  lines.push("Sections:");
  for (const s of info.sections) {
    const diff = s.lastDiffPercent !== undefined ? ` (diff: ${s.lastDiffPercent}%)` : "";
    lines.push(`  ${String(s.index).padStart(2, "0")}. ${s.name} [${s.status}]${diff}`);
  }
  lines.push("");
  lines.push(`Assets: ${info.assetCounts.total} total, ${info.assetCounts.pending} pending, ${info.assetCounts.downloaded} downloaded, ${info.assetCounts.failed} failed`);
  lines.push("");
  if (info.currentSectionSpec) {
    lines.push("Current section spec:");
    lines.push(info.currentSectionSpec);
    lines.push("");
  }
  lines.push("The Figma package is the only source of truth. Your previous output is not a reference. Do not guess values. Use only assets from assets.json.");
  lines.push("=== END DESIGN ANCHOR ===");
  return lines.join("\n");
}