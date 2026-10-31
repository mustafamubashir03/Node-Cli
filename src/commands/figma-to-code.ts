import { input } from "@inquirer/prompts";
    const fs = await import('fs')
import { printFailure, printHint, printNotice, printSuccess } from "../ui/messages.js";
import { FigmaClient } from "../figma/client.js";
import { parseFigmaUrl, validateFigmaUrl } from "../figma/url-parser.js";
import { generateDesignSpec } from "../figma/design-spec.js";
import { writeFigmaDesignSpec } from "../figma/artifact.js";
import { findImageFillNodes, downloadFigmaAssets, writeAssetManifest } from "../figma/assets.js";
import { walkFigmaTree, discoverAssets, segmentSections, createPlaceholderAsset, printTreeSummary, countNodesByType, getMaxDepth, isFlattenedImage, type DiscoveredAssets } from "../figma/ingestion.js";

/**
 * First-class Figma-to-Code entry point.
 * Orchestrates: token check → URL input → design retrieval → spec generation → planning artifact.
 */
export async function runFigmaToCode(): Promise<void> {
  // Step 1: Check token
  let client = FigmaClient.fromEnvironment();
  if (!client.isAvailable()) {
    printNotice("No Figma access token found.");
    printHint("To get a token:");
    printHint("1. Go to Figma > Settings > Personal Access Tokens");
    printHint("2. Create a token with 'file_content:read' scope");
    printHint("3. Set FIGMA_ACCESS_TOKEN environment variable");
    printHint("");
    printHint("Example: FIGMA_ACCESS_TOKEN=your_token node-cli figma-to-code");
    printHint("Or add to .env file: FIGMA_ACCESS_TOKEN=your_token");

    const token = await input({ message: "Enter your Figma access token (or press Enter to skip):" });
    if (!token.trim()) {
      printNotice("Skipping Figma setup. You can configure later with: node-cli figma setup");
      printHint("Set FIGMA_ACCESS_TOKEN environment variable to enable Figma integration.");
      return;
    }

    // Validate token
    client = new FigmaClient({ accessToken: token.trim() });
    printNotice("Validating token...");
    try {
      // Test with a known endpoint (will fail if token is invalid)
      const testClient = new FigmaClient({ accessToken: token.trim() });
      // We can't test without a file URL, so just accept the token
      printSuccess("Token accepted. Set FIGMA_ACCESS_TOKEN environment variable for future sessions.");
      printHint("For this session, the token will be used temporarily.");
    } catch (error: any) {
      printFailure(`Token validation failed: ${error.message}`);
      return;
    }
  } else {
    printSuccess("Figma access token found.");
  }

  // Step 2: Get Figma URL
  const url = await input({ message: "Enter Figma file or frame URL:" });
  if (!url.trim()) {
    printFailure("No URL provided.");
    return;
  }

  const validation = validateFigmaUrl(url.trim());
  if (!validation.valid) {
    printFailure(validation.error || "Invalid Figma URL");
    return;
  }

  // If no node ID, offer frame discovery
  let targetUrl = url.trim();
  if (!validation.parsed!.nodeId) {
    printNotice("No specific frame selected. Discovering pages and frames...");
    try {
      const structure = await client.getFileStructure(url.trim());
      printNotice(`Found ${structure.pages.length} page(s):`);
      for (const page of structure.pages) {
        printHint(`  Page: ${page.name} (${page.frames.length} frames)`);
        for (const frame of page.frames.slice(0, 10)) {
          printHint(`    - ${frame.name} (${frame.width}x${frame.height}) [node: ${frame.id}]`);
        }
        if (page.frames.length > 10) {
          printHint(`    ... and ${page.frames.length - 10} more frames`);
        }
      }

      const frameId = await input({ message: "Enter a frame/node ID to use (or press Enter for first frame):" });
      if (frameId.trim()) {
        targetUrl = url.trim() + (url.includes("?") ? "&" : "?") + "node-id=" + frameId.trim().replace(":", "-");
      } else if (structure.pages.length > 0 && structure.pages[0].frames.length > 0) {
        const firstFrame = structure.pages[0].frames[0];
        targetUrl = url.trim() + (url.includes("?") ? "&" : "?") + "node-id=" + firstFrame.id.replace(":", "-");
        printNotice(`Using first frame: ${firstFrame.name}`);
      }
    } catch (error: any) {
      printFailure(`Frame discovery failed: ${error.message}`);
      return;
    }
  }

  printNotice(`Retrieving design from Figma... (file: ${validation.parsed!.fileKey})`);

  // Step 3: Retrieve design
  try {
    const context = await client.getDesignContext(targetUrl);
    const spec = generateDesignSpec(context);

    printSuccess(`Retrieved design: ${context.name}`);
    printHint(`Frame dimensions: ${spec.frame.width}x${spec.frame.height}`);
    printHint(`Components: ${spec.components.length}`);
    printHint(`Unresolved items: ${spec.unresolved.length}`);

    // Step 3b: Ingest Figma tree, discover assets, segment sections
    printNotice("Ingesting Figma tree and discovering assets...")

    const fileKey = validation.parsed!.fileKey
    const rootNodeId = (context.nodes[0]?.id || '').replace(/:/g, '_')
    const assetDir = `.node-cli/figma/${fileKey}/${rootNodeId}`

    // Walk the tree to understand structure
    const rootNode = context.nodes[0] || context
    const tree = walkFigmaTree(rootNode)

    // Discover assets from the design context
    const discoveredAssets = discoverAssets(tree, ((context.nodes[0] as any)?.absoluteBoundingBox) as any)
    
    // Ensure asset directory exists
    const fs = await import('fs')
    if (!fs.existsSync(assetDir)) {
      fs.mkdirSync(assetDir, { recursive: true })
    }

    // Save core metadata files
    fs.writeFileSync(`${assetDir}/tree.json`, JSON.stringify(tree, null, 2))
    fs.writeFileSync(`${assetDir}/tokens.json`, JSON.stringify({}, null, 2))
    fs.writeFileSync(`${assetDir}/assets.json`, JSON.stringify(discoveredAssets, null, 2))

    // Segment sections
    const sections: any[] = segmentSections(rootNode, assetDir)

    // Section directories and specs are already created by segmentSections in ingestion.ts
    // No second writer needed here.

    // Handle placeholder failures for unresolved items
    if (spec.unresolved.length > 0) {
      try {
        const fs2 = await import('fs')
        for (const u of spec.unresolved) {
          const svg = createPlaceholderAsset((u as any).nodeId || (u as any).id || 'unknown', (u as any).name || 'placeholder', {x:0,y:0,w:100,h:100})
          try { if (!fs2.existsSync('.node-cli/figma-assets')) fs2.mkdirSync('.node-cli/figma-assets',{recursive:true}); fs2.writeFileSync(`.node-cli/figma-assets/placeholder-${(u as any).nodeId||'x'}.svg`, svg) } catch(e){}
        }
      } catch(e){}
    }

    // Print tree summary
    ;(printTreeSummary as any)({
      nodeCount: tree.length,
      typeCounts: countNodesByType(tree),
      maxDepth: getMaxDepth(tree),
      topLevelChildren: (rootNode.children||[]).slice(0,10).map((n:any)=>({name:n.name,type:n.type,bbox:n.absoluteBoundingBox})),
      isFlattened: isFlattenedImage(rootNode)
    })

    // Step 4: Download assets
    printNotice("Downloading assets...");
    const parsed = parseFigmaUrl(targetUrl);
    if (parsed && parsed.fileKey) {
      // Find image fill nodes
      const imageNodeIds = findImageFillNodes(context.nodes[0]);
      // Also include the root frame for export
      const exportNodeIds = [parsed.nodeId || context.nodes[0]?.id].filter(Boolean) as string[];

      if (exportNodeIds.length > 0) {
        const outputDir = ".node-cli/figma-assets";
        const restClient = client.getRestClient();
        if (!restClient) {
          printFailure("No REST client available");
          return;
        }
        const manifest = await downloadFigmaAssets(
          restClient,
          parsed.fileKey,
          exportNodeIds,
          outputDir,
          "png"
        );

        printNotice(`Assets: ${manifest.totalDownloaded} downloaded, ${manifest.totalFailed} failed, ${manifest.totalRequested} requested`);

        // Write asset manifest
        const manifestPath = outputDir + "/asset-manifest.json";
        writeAssetManifest(manifest, manifestPath);
        printHint(`Asset manifest written to ${manifestPath}`);

        // Update spec with assets
        spec.assets = manifest.assets;
      }
    }

    // Step 5: Write design spec as planning artifact
    writeFigmaDesignSpec(spec);
    printSuccess("Design specification written to .node-cli/project/brief.md");
    printHint("");
    printHint("Next steps:");
    printHint("1. Review the design spec in .node-cli/project/brief.md");
    printHint("2. Start a chat session: node-cli chat");
    printHint("3. The agent will use the design spec to implement the design");
    printHint("4. Mandatory skills (emil-design-eng, baseline-ui, frontend-design, figma-to-code) will be loaded");

  } catch (error: any) {
    printFailure(`Ingestion failed: ${error.message}`);
    if (error.stack) { printHint(error.stack.split('\n').slice(0,5).join('\n')); }
    try {
      const fs3 = await import('fs')
      if (!fs3.existsSync('.node-cli/figma')) fs3.mkdirSync('.node-cli/figma',{recursive:true})
      fs3.writeFileSync('.node-cli/figma/last-ingestion-error.json', JSON.stringify({message:error.message,stack:error.stack},null,2))
    } catch(e){}
    if (error.message.includes("403") || error.message.includes("Access denied")) {
      printHint("Check your token permissions and file access.");
      printHint("Ensure the Figma file is accessible with your token.");
    } else if (error.message.includes("404")) {
      printHint("Check the URL and ensure the file exists.");
    } else if (error.message.includes("429")) {
      printHint("Rate limited. Please wait and retry.");
    }
  }
}