---
name: figma-to-code
description: Guide for converting Figma designs to code using Node CLI's Figma integration
category: design
triggers: [figma, design-to-code, figma-url, figma-design]
contextTokens: 2000
---

# Figma-to-Code Skill

## Overview
This skill guides the agent through converting Figma designs into working code.

## Workflow
1. Parse the Figma URL to extract file key and node ID
2. Retrieve design context using FigmaClient
3. Generate a structured design specification
4. Extract design tokens (colors, typography, spacing)
5. Download original assets
6. Implement the design in the user's project framework
7. Run visual QA against the Figma reference

## Key Principles
- Use original Figma assets, never generate substitutes
- Extract exact values from the design, don't approximate
- Reuse existing project components when possible
- Implement responsive behavior based on design evidence
- Run visual comparison after implementation
- Report discrepancies honestly

## Tool Usage
- `figma_get_design_context`: Retrieve design data from Figma
- `figma_download_assets`: Download images and SVGs
- `figma_get_variables`: Extract design tokens
- `figma_get_screenshot`: Get reference screenshot

## Mandatory Skills for Figma Tasks
- emil-design-eng (design foundation)
- baseline-ui (UI quality)
- frontend-design (implementation)
- figma-to-code (this skill)