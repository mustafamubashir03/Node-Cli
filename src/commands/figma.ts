import { printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";
import { FigmaClient } from "../figma/client.js";
import { parseFigmaUrl, validateFigmaUrl } from "../figma/url-parser.js";

/**
 * Figma setup command - configure access token.
 */
export async function runFigmaSetup(): Promise<void> {
  const token = process.env.FIGMA_ACCESS_TOKEN || process.env.FIGMA_TOKEN;
  if (token) {
    printNotice("Figma token found in environment variables.");
    const client = FigmaClient.fromEnvironment();
    if (client.isAvailable()) {
      printSuccess("Figma integration is available.");
      printHint("Token is set via environment variable. To change, update FIGMA_ACCESS_TOKEN or FIGMA_TOKEN.");
    } else {
      printFailure("Token found but client not available. Check token format.");
    }
  } else {
    printNotice("No Figma token found.");
    printHint("To configure Figma access:");
    printHint("1. Go to Figma > Settings > Personal Access Tokens");
    printHint("2. Create a token with file read permissions");
    printHint("3. Set the environment variable: FIGMA_ACCESS_TOKEN=your_token");
    printHint("4. Or add it to your .env file: FIGMA_ACCESS_TOKEN=your_token");
    printHint("");
    printHint("Required scopes: file_content:read, file_metadata:read");
  }
}

/**
 * Figma status command - check connection status.
 */
export async function runFigmaStatus(): Promise<void> {
  const client = FigmaClient.fromEnvironment();
  if (!client.isAvailable()) {
    printFailure("Figma is not configured. Run 'node-cli figma setup' to configure.");
    return;
  }

  printNotice("Figma client is configured.");
  printHint("Token source: " + (process.env.FIGMA_ACCESS_TOKEN ? "FIGMA_ACCESS_TOKEN" : "FIGMA_TOKEN"));
  printHint("To test the connection, run: node-cli figma test <figma-url>");
}

/**
 * Figma test command - test connection with a URL.
 */
export async function runFigmaTest(url: string): Promise<void> {
  const validation = validateFigmaUrl(url);
  if (!validation.valid) {
    printFailure(validation.error || "Invalid Figma URL");
    return;
  }

  const client = FigmaClient.fromEnvironment();
  if (!client.isAvailable()) {
    printFailure("Figma is not configured. Set FIGMA_ACCESS_TOKEN environment variable.");
    return;
  }

  printNotice(`Testing connection to Figma file: ${validation.parsed!.fileKey}...`);
  try {
    const context = await client.getDesignContext(url);
    printSuccess(`Successfully connected! File: ${context.name}`);
    printHint(`Last modified: ${context.lastModified}`);
    printHint(`Top-level nodes: ${context.nodes.length}`);
    if (context.nodeId) {
      printHint(`Selected node: ${context.nodeId}`);
    }
  } catch (error: any) {
    printFailure(`Connection failed: ${error.message}`);
    if (error.message.includes("403") || error.message.includes("Access denied")) {
      printHint("Check your token permissions and file access.");
    } else if (error.message.includes("404")) {
      printHint("Check the URL and ensure the file exists.");
    } else if (error.message.includes("429")) {
      printHint("Rate limited. Please wait and retry.");
    }
  }
}

/**
 * Figma disconnect command - remove configuration.
 */
export async function runFigmaDisconnect(): Promise<void> {
  printNotice("To disconnect Figma, remove the FIGMA_ACCESS_TOKEN or FIGMA_TOKEN environment variable.");
  printHint("If set in .env file, remove the line from .env");
  printHint("If set as system environment variable, unset it in your shell profile");
}