---
name: fidelity-rules
description: Rules for fidelity mode when a Figma design package is active
category: design
triggers: [fidelity, design-package, package-active]
contextTokens: 500
---

# Fidelity Mode Rules

When a Figma design package is active (`.node-cli/figma/` directory exists), the following rules apply:

## 1. Design Anchor is the Only Source of Truth
- The Figma package is the only source of truth. Your previous output is not a reference.
- Do not guess values. Use only assets from `assets.json`.
- Do not reference images, colors, or dimensions outside the design package.

## 2. Read-Before-Write Gate
- Writes to `index.html`, `styles/**`, `sections/**` are denied with `REFERENCE_NOT_CONSULTED` until you have read `index.md` and the spec of the section being edited this session.

## 3. Package is Read-Only
- The design package at `.node-cli/figma/` is PROTECTED_PATH. No stock-image tools unless the `approximate` flag is on.
- Do not reference images outside `assets.json`.

## 4. One Section at a Time
- Focus on one section at a time. Each section has its own `spec.md` in `sections/NN-slug/`.
- Do not rewrite a section from memory. Use the code-generated structure.

## 5. Asset Usage
- All images must reference manifest paths from `assets.json`.
- No hotlinked URLs, no CDN, no external image sources.
- Placeholders must be labeled with `status: approximate` if generated.

## 6. Fidelity Mode Detection
- `isFidelityMode()` is true when `.node-cli/figma/` holds a package.
- Every turn gets a "design anchor" block prepended to the system prompt.

## 7. Skill Selection in Fidelity Mode
- Mandatory design skills (`frontend-design`, `baseline-ui`, `emil-design-eng`) are always loaded.
- Creative skills (`impeccable`, `no-ai-slop`, `apple-design`, `theme-factory`, and creative parts of `frontend-design`) are excluded.
- The `figma-to-code` skill is always loaded in fidelity mode.

## 8. Skill Conflict Matrix
- `figma-to-code` conflicts with `impeccable`, `no-ai-slop`, `apple-design`
- `frontend-design` conflicts with creative parts of itself
- Only one skill from each conflict group may be active per turn.

## 9. Budget Tracking
- Per-skill cost is logged. Total budget must not exceed limit.
- Budget swings from 4819→4019→1400 are from per-skill calculations, not recalculations.

## 10. Resume Persistence
- On session resume, the design anchor block is present on the first turn.
- Skill selection state is persisted and restored.
---