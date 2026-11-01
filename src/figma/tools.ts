import { tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { FigmaClient } from "./client.js";
import { parseFigmaUrl } from "./url-parser.js";
import { generateDesignSpec } from "./design-spec.js";
import { writeFigmaDesignSpec } from "./artifact.js";
import { printNotice, printFailure } from "../ui/messages.js";

/**
 * Create Figma tools for the agent.
 * These are native SDK tools that the agent can call during reasoning.
 */
export function createFigmaTools() {
  const client = FigmaClient.fromEnvironment();

  return [
    tool(
      "FigmaGetDesignContext",
      "Retrieve design context from a Figma file or selected frame. Returns the design structure, layout, and visual properties.",
      {
        url: z.string().describe("Figma file or frame URL (e.g., https://www.figma.com/design/FILE_KEY/Name?node-id=1-2)"),
      },
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
          return {
            content: [{ type: "text" as const, text: JSON.stringify(spec, null, 2) }],
          };
        } catch (error: any) {
          printFailure(`FigmaGetDesignContext failed: ${error.message}`);
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    ),

    tool(
      "FigmaParseUrl",
      "Parse a Figma URL to extract file key and node ID.",
      {
        url: z.string().describe("Figma file or frame URL"),
      },
      async ({ url }) => {
        const parsed = parseFigmaUrl(url);
        if (!parsed) {
          return {
            content: [{ type: "text" as const, text: "Invalid Figma URL. Expected format: https://www.figma.com/design/FILE_KEY/Name?node-id=1-2" }],
            isError: true,
          };
        }
        printNotice(`FigmaParseUrl: fileKey=${parsed.fileKey}, nodeId=${parsed.nodeId || "none"}`);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(parsed, null, 2) }],
        };
      }
    ),

    tool(
      "FigmaWriteDesignSpec",
      "Write a Figma design specification as a planning artifact (brief.md).",
      {
        spec: z.string().optional().describe("JSON string of the Figma design specification"),
        projectRoot: z.string().optional().describe("Project root directory"),
      },
      async ({ spec, projectRoot }) => {
        // Validate input
        if (!spec || typeof spec !== "string" || spec.trim() === "") {
          const msg = "Missing required field: 'spec'. Provide a JSON string of the Figma design specification. Optional: 'projectRoot' (defaults to cwd).";
          printFailure(`FigmaWriteDesignSpec failed: ${msg}`);
          return {
            content: [{ type: "text" as const, text: `Error: ${msg}` }],
            isError: true,
          };
        }
        try {
          const parsed = JSON.parse(spec);
          // Validate parsed spec has required fields
          if (!parsed || typeof parsed !== "object") {
            throw new Error("spec must be a valid JSON object");
          }
          if (!parsed.source || typeof parsed.source !== "object") {
            throw new Error("spec.source is required (must include fileKey)");
          }
          if (!parsed.source.fileKey) {
            throw new Error("spec.source.fileKey is required");
          }
          writeFigmaDesignSpec(parsed, projectRoot);
          printNotice("FigmaWriteDesignSpec: design spec written to brief.md");
          return {
            content: [{ type: "text" as const, text: "Design specification written to .node-cli/project/brief.md" }],
          };
        } catch (error: any) {
          printFailure(`FigmaWriteDesignSpec failed: ${error.message}`);
          return {
            content: [{ type: "text" as const, text: `Error: ${error.message}` }],
            isError: true,
          };
        }
      }
    ),
  ];
}