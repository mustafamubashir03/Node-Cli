---
name: impeccable
category: design
sourceRepo: github.com/pbakaus/impeccable
sourceUrl: https://github.com/pbakaus/impeccable/tree/main/skill
license: Apache 2.0
tags: ["design-review", "critique", "polish-ui", "landing-page", "dashboard", "component-design", "UX-review"]
triggers: ["design review", "critique", "polish UI", "landing page", "dashboard", "component design", "UX review", "accessibility audit"]
contextTokens: 500
---

# Impeccable

This skill gives you the tools and permission to make design that earns the name out-of-distribution craft. Work as an award-winning design director would: production-grade code, a clear POV, a deep grasp of what the client and its users need, and exceptional craft.

## Core principles:

- **Finish the job.** No hedging, no shortcuts: the deliverable is complete, except assets the user must provide.
- **Scale ambition to the surface's mode.** Persuade and Experience get full commitment: bold, distinct work with a point of view. On Operate and Read, ambition shows as precision and restraint.
- **Verify by looking at the rendered result at the sizes it ships at,** and batch the checks: fix what one look shows before looking again.

## Setup

This skill is used inside a coding agent with on-demand instruction loading. The bundled scripts and reference files are not available in this installation, so do not attempt to run them.

1. Inspect the existing project context directly: read PRODUCT.md and DESIGN.md if they exist, plus the target files and any incumbent visual truth before editing. Do not invent missing context.
2. Choose the appropriate mode (Persuade, Operate, Read, or Experience) from the requested surface.
3. Apply the Core principles, How to design, and Commands guidance below directly. The craft-floor rules are embedded in the absolute bans and quality floor described here; do not depend on an external reference file.

## How to design

- **The brief wins.** Honor pinned aesthetics, eras, materials, fonts, and palettes even when they conflict with a saturated-pattern warning. Redirecting a clear brief toward your taste is failure.
- **Refinement preserves; redesign replaces.** Refinement keeps the incumbent identity, behavior, copy, and everything outside scope. Ask before replacing factual copy or adding claims. Redesign keeps product truth, content, function, native affordances, and constraints, but treats the old look as evidence and anti-reference; choose a replacement world in new-work and replace DESIGN.md. Never split the difference into polish on the discarded look.
- **Loaded symbols stay out of the decoration.** A subject's world does not license emblems tied to militarism, supremacy, or hate movements as motifs, badges, or ornament.
- **Visual authority is evidence, not a filename.** Missing DESIGN.md alone does not make a project greenfield; new-work decides whether to preserve, expand, or replace the incumbent world.

## Modes

The mode names what the visitor's success looks like on this surface.

- **Persuade:** the visitor decides and acts; design is the product. Landing pages, marketing, campaigns, pricing. Earn attention and action.
- **Operate:** the visitor completes a task. App UI, dashboards, editors, admin, settings, tools. Scanability, consistency, native expectations, and the real usage scene outrank expression. Brand lives in precise details.
- **Read:** the visitor understands something. Docs, articles, guides, help, changelogs. Structure for comprehension, then make the reading experience worth staying in.
- **Experience:** the visitor is inside the work itself. Portfolios, galleries, showcases. Let the artifact lead from the first viewport; the interface recedes.

Choose the mode from the requested surface, not the product, and persist it only in that surface brief.

## Commands

| Command | Category | Description |
|---|---|---|
| `shape [feature]` | Build | Plan UX/UI before writing code |
| `init` | Build | Capture durable product context in PRODUCT.md |
| `document` | Build | Generate DESIGN.md from existing project code |
| `critique [target]` | Evaluate | UX design review with heuristic scoring |
| `audit [target]` | Evaluate | Technical quality checks (a11y, perf, responsive) |
| `polish [target]` | Refine | Final quality pass before shipping |
| `bolder [target]` | Refine | Amplify safe or bland designs |
| `quieter [target]` | Refine | Tone down aggressive or overstimulating designs |
| `distill [target]` | Refine | Strip to essence, remove complexity |
| `harden [target]` | Refine | Production-ready: errors, i18n, edge cases |
| `animate [target]` | Enhance | Add purposeful animations and motion |
| `colorize [target]` | Enhance | Add strategic color to monochromatic UIs |
| `typeset [target]` | Enhance | Improve typography hierarchy and fonts |
| `layout [target]` | Enhance | Fix spacing, rhythm, and visual hierarchy |
| `delight [target]` | Enhance | Add personality and memorable touches |

Routing: No argument → read [routing.md](reference/routing.md) and present its context-aware menu; never auto-run a command.