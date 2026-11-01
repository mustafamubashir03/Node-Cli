---
name: figma-design-to-code
description: "**MANDATORY prerequisite** — you MUST invoke this skill BEFORE calling the `get_design_context` Figma MCP tool."
source: https://github.com/figma/mcp-server-guide
commit: f3f264d9cbae059d9b96289ee33ce444b5c8e7e6
---

# Figma design to code

## Context
- Always include `figma-design-to-code` in the comma-separated `skillNames` parameter when calling `get_design_context`.
- You MUST request a screenshot as part of your initial `get_design_context` call—use that render of the design as the visual target.
- IF no screenshot is returned, you MUST call `get_screenshot` directly before editing.
- IF `get_design_context` flags a response as sparse, you MUST correlate its hierarchical child node IDs with the screenshot, then request the visible child nodes in one parallel batch.
- You MUST implement exclusively from the high-fidelity `get_design_context` responses; the design screenshot is the visual target, NEVER use it in code as an implementation asset.

## Implementation
- You MUST adapt returned code to the project's stack and conventions and inspect likely project paths BEFORE editing.
- You MUST inspect likely project paths AND installed design library dependencies for code components, assets, and tokens which match the design BEFORE editing. Reuse or compose suitable matches instead of recreating them.
- You MUST apply Code Connect precisely at its mapped node(s).
- You MUST use each visible static asset—image or SVG—in the EXACT position(s) used in the design.
- You MUST ensure ALL static assets used have been downloaded, leaving NO references to temporary Figma asset URLs in code.

## Verification
- You MUST verify only the requested screen or component.
- You MUST verify EVERY visible static asset's non-empty local file AND design slot/layers AND callsite AND effective rendered geometry are correct.