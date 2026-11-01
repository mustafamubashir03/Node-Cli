import { createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { FigmaClient } from "./client.js";
import { parseFigmaUrl } from "./url-parser.js";
import { generateDesignSpec } from "./design-spec.js";
import { writeFigmaDesignSpec } from "./artifact.js";
import { printNotice, printFailure } from "../ui/messages.js";

/**
 * Create a Figma MCP server for the agent.
 * Provides tools for Figma design extraction and analysis.
 */
export function createFigmaMcpServer() {
  const client = FigmaClient.fromEnvironment();

  return createSdkMcpServer({
    name: "node-cli-figma",
    version: "1.0.0",
    tools: [
      tool(
        "FigmaParseUrl",
        "Parse a Figma URL to extract file key and node ID.",
        { url: z.string().describe("Figma file or frame URL") },
        async ({ url }) => {
          const parsed = parseFigmaUrl(url);
          if (!parsed) {
            return {
              content: [{ type: "text" as const, text: "Invalid Figma URL. Expected format: https://www.figma.com/design/FILE_KEY/Name?node-id=1-2" }],
              isError: true,
            };
          }
          printNotice(`FigmaParseUrl: fileKey=${parsed.fileKey}, nodeId=${parsed.nodeId || "none"}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }] };
        }
      ),

      tool(
        "FigmaGetDesignContext",
        "Retrieve design context from a Figma file or selected frame. Returns structured design specification including layout, tokens, components, and assets.",
        { url: z.string().describe("Figma file or frame URL") },
        async ({ url }) => {
          if (!client.isAvailable()) {
            return {
              content: [{ type: "text" as const, text: "Figma is not configured. Set FIGMA_ACCESS_TOKEN environment variable." }],
              isError: true,
            };
          }
          try {
            const context = await client.getDesignContext(url);
            const spec = generateDesignSpec(context);
            printNotice(`FigmaGetDesignContext: retrieved ${context.name} (${context.nodes.length} top-level nodes)`);
            return { content: [{ type: "text" as const, text: JSON.stringify(spec, null, 2) }] };
          } catch (error: any) {
            printFailure(`FigmaGetDesignContext failed: ${error.message}`);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
          }
        }
      ),

      tool(
        "FigmaWriteDesignSpec",
        "Write a Figma design specification as a planning artifact (brief.md).",
        {
          spec: z.string().describe("JSON string of the Figma design specification"),
          projectRoot: z.string().optional().describe("Project root directory"),
        },
        async ({ spec, projectRoot }) => {
          try {
            const parsed = JSON.parse(spec);
            writeFigmaDesignSpec(parsed, projectRoot);
            printNotice("FigmaWriteDesignSpec: design spec written to brief.md");
            return { content: [{ type: "text" as const, text: "Design specification written to .node-cli/project/brief.md" }] };
          } catch (error: any) {
            printFailure(`FigmaWriteDesignSpec failed: ${error.message}`);
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
          }
        }
      ),

      tool(
        "FigmaStatus",
        "Check Figma integration status and authentication.",
        {},
        async () => {
          if (!client.isAvailable()) {
            return { content: [{ type: "text" as const, text: "Figma is not configured. Set FIGMA_ACCESS_TOKEN environment variable." }] };
          }
          return { content: [{ type: "text" as const, text: "Figma is configured and available." }] };
        }
      ),

      tool(
        "FigmaDownloadAssets",
        "Download assets (images, SVGs) from a Figma file for specified node IDs.",
        {
          fileKey: z.string().describe("Figma file key"),
          nodeIds: z.array(z.string()).describe("Array of node IDs to export"),
          outputDir: z.string().describe("Output directory for downloaded assets"),
          format: z.enum(["svg", "png", "jpg"]).optional().describe("Export format (default: png)"),
        },
        async ({ fileKey, nodeIds, outputDir, format }) => {
          const restClient = client.getRestClient();
          if (!restClient) {
            return { content: [{ type: "text" as const, text: "Figma is not configured." }], isError: true };
          }
          try {
            const { downloadFigmaAssets, writeAssetManifest } = await import("./assets.js");
            const manifest = await downloadFigmaAssets(restClient, fileKey, nodeIds, outputDir, format || "png");
            writeAssetManifest(manifest, outputDir + "/asset-manifest.json");
            const summary = `Downloaded ${manifest.totalDownloaded}/${manifest.totalRequested} assets (${manifest.totalFailed} failed)`;
            return { content: [{ type: "text" as const, text: summary + "\n" + JSON.stringify(manifest.assets, null, 2) }] };
          } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
          }
        }
      ),

      tool(
        "FigmaListFrames",
        "List pages and frames in a Figma file for frame discovery.",
        { url: z.string().describe("Figma file URL (without node-id)") },
        async ({ url }) => {
          if (!client.isAvailable()) {
            return { content: [{ type: "text" as const, text: "Figma is not configured." }], isError: true };
          }
          try {
            const structure = await client.getFileStructure(url);
            const summary = structure.pages.map((p) =>
              `Page: ${p.name} (${p.frames.length} frames)\n` +
              p.frames.map((f) => `  - ${f.name} (${f.width}x${f.height}) [node: ${f.id}]`).join("\n")
            ).join("\n\n");
            return { content: [{ type: "text" as const, text: summary || "No frames found." }] };
          } catch (error: any) {
            return { content: [{ type: "text" as const, text: `Error: ${error.message}` }], isError: true };
          }
        }
      ),
    ],
  });
}