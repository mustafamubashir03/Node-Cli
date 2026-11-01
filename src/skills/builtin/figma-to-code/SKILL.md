---
name: figma-to-code
category: design
sourceRepo: adapted from figma/mcp-server-guide
sourceUrl: https://github.com/figma/mcp-server-guide
license: MIT
tags: ["figma", "design-to-code", "asset-inventory", "auto-layout", "tokens"]
triggers: ["figma", "implement design", "design to code", "figma to code", "figma frame", "figma url"]
contextTokens: 1200
---

# Figma to Code (node-cli adapted)

## Sources
- figma/mcp-server-guide: figma-design-to-code (commit f3f264d)
- figma/mcp-server-guide: figma-code-workflows (commit f3f264d)

## Instructions

### 1. Fetch context BEFORE coding
- Call FigmaGetDesignContext with the file key and node id.
- Request a screenshot as part of the initial call. Use it as the visual target.
- If no screenshot returned, call FigmaListFrames to get frame previews.
- If response is sparse, fetch child nodes in parallel batches.

### 2. Asset inventory
- Run FigmaDownloadAssets to export all per-node assets.
- Check .node-cli/figma/<key>/<node>/assets/ for downloaded files.
- Every <img> must reference a path in assets.json. Never use reference/full.png or 1-2.png as content.
- Labeled placeholders are acceptable only when status: placeholder in assets.json.

### 3. Auto Layout to CSS mapping
| Figma | CSS |
|-------|-----|
| layoutMode: HORIZONTAL | display: flex; flex-direction: row |
| layoutMode: VERTICAL | display: flex; flex-direction: column |
| itemSpacing | gap: <value>px |
| paddingTop/Right/Bottom/Left | padding: <t>px <r>px <b>px <l>px |
| primaryAxisSizingMode: FIXED | width: <value>px |
| counterAxisSizingMode: FIXED | height: <value>px |
| primaryAxisSizingMode: AUTO | width: auto / fit-content |
| layoutWrap: WRAP | flex-wrap: wrap |

### 4. Variables to tokens
- Extract Figma variables into .node-cli/figma/<key>/<node>/tokens.json
- Each token lists its node ids
- Generate styles/tokens.css from tokens.json
- Never hardcode colors, spacing, or typography values

### 5. Read the package first
- Read .node-cli/figma/<key>/<node>/index.md for the full inventory
- Read the current section's spec.md for exact measurements
- Read assets.json for available assets
- The Figma package is the only source of truth

### 6. Section-by-section implementation
- Implement one section at a time
- Every element must have data-figma-node="<id>"
- Section roots must have data-section="NN"
- Use exact TEXT characters from the spec
- Use only assets from assets.json
- Never invent copy, colors, or imagery

### 7. Verification
- Render at 1440px and compare with reference.png
- Check text coverage: all 168 TEXT strings must appear
- Check no CDN or hotlinks in HTML
- Check every <img> maps to assets.json
- Run [VERIFY] before declaring done

### 8. Quality gates
- No reference/full.png or 1-2.png as content image
- No Tailwind or CDN
- No hardcoded values (use tokens)
- HTML must parse without errors
- No writes outside workspace
