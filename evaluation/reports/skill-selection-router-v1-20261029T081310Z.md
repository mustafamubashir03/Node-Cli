# Skill selection evaluation — router-v1

- Generated: 2026-10-29T08:13:10.900Z
- Dataset: `evaluation\skill-selection.v1.json` (version 1, sha256 `b1f7e30f65510fb3…`)
- Dataset size: 28 cases (27 positive, 1 expect-none)
- Available skills: 25
- Hit@3: 100.0% (27/27)
- Hit@1: 100.0% (27/27)
- Pass rate: 100.0% (28/28)

This evaluation is deterministic. It calls the production selector only; it does not
invoke a model, and no thresholds were tuned against these labels.

## Aggregate metrics

| Metric | Value |
|---|---|
| Passed | 28/28 (100.0%) |
| Hit@1 | 27/27 (100.0%) |
| Hit@3 | 27/27 (100.0%) |
| Forbidden-skill violations | 0 |
| Empty selections | 1 |
| Budget overruns | 3 |
| Average selected skills | 1.46 |
| Average required-skill precision | 81.5% |
| Average selected tokens | 1624.6 |

`Hit` measures whether any expected skill was selected. `Required-skill precision`
is the share of selected skills that were named as expected; it is a lower bound
because the labels do not enumerate every reasonable alternative.

## By mode

| Bucket | Cases | Passed | Pass rate | Hit@1 | Hit@3 | Forbidden |
|---|---|---|---|---|---|---|
| agent | 27 | 27 | 100.0% | 100.0% | 100.0% | 0 |
| ask | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |

## By tag

| Bucket | Cases | Passed | Pass rate | Hit@1 | Hit@3 | Forbidden |
|---|---|---|---|---|---|---|
| 3d | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| a11y | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| artifacts | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| backend | 3 | 3 | 100.0% | 100.0% | 100.0% | 0 |
| config | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| database | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| debugging | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| design | 8 | 8 | 100.0% | 100.0% | 100.0% | 0 |
| frontend | 3 | 3 | 100.0% | 100.0% | 100.0% | 0 |
| mcp | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| mode | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| motion | 2 | 2 | 100.0% | 100.0% | 100.0% | 0 |
| negative | 1 | 1 | 100.0% | 0.0% | 0.0% | 0 |
| performance | 2 | 2 | 100.0% | 100.0% | 100.0% | 0 |
| quality | 6 | 6 | 100.0% | 100.0% | 100.0% | 0 |
| react | 2 | 2 | 100.0% | 100.0% | 100.0% | 0 |
| regression | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| review | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| security | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| seo | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| styling | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| testing | 2 | 2 | 100.0% | 100.0% | 100.0% | 0 |
| theming | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| tooling | 5 | 5 | 100.0% | 100.0% | 100.0% | 0 |
| verification | 1 | 1 | 100.0% | 100.0% | 100.0% | 0 |
| workflow | 3 | 3 | 100.0% | 100.0% | 100.0% | 0 |

## Failures

None.

## Cases

| Case | Mode | Expected any | Selected | Hit@1 | Pass |
|---|---|---|---|---|---|
| landing-page-design | agent | frontend-design | frontend-design | yes | yes |
| design-polish-existing | agent | frontend-design, baseline-ui | baseline-ui | yes | yes |
| accessibility-audit | agent | accessibility | accessibility | yes | yes |
| animation-spring | agent | emil-design-eng, apple-design | apple-design, emil-design-eng, improve-animations | yes | yes |
| react-rerenders | agent | react-performance | react-performance | yes | yes |
| seo-metadata | agent | seo-metadata | seo-metadata | yes | yes |
| postgres-index | agent | postgres-best-practices | postgres-best-practices | yes | yes |
| mcp-server | agent | mcp-builder | mcp-builder | yes | yes |
| debug-crash | agent | systematic-debugging | systematic-debugging, test-driven-development, verification-before-completion | yes | yes |
| tdd-feature | agent | test-driven-development | test-driven-development, systematic-debugging | yes | yes |
| implementation-plan | agent | writing-plans | writing-plans, postgres-best-practices | yes | yes |
| verification-pr | agent | verification-before-completion | verification-before-completion | yes | yes |
| tailwind-tokens | agent | tailwindcss-development | tailwindcss-development | yes | yes |
| ui-library-toasts | agent | pick-ui-library | pick-ui-library, apple-design, emil-design-eng | yes | yes |
| theme-palette | agent | theme-factory | theme-factory, frontend-design | yes | yes |
| playwright-e2e | agent | webapp-testing | webapp-testing | yes | yes |
| interactive-3d | agent | interactive-3d | interactive-3d | yes | yes |
| single-html-artifact | agent | web-artifacts-builder | web-artifacts-builder | yes | yes |
| anti-ai-slop | agent | no-ai-slop | no-ai-slop | yes | yes |
| core-web-vitals | agent | core-web-vitals | core-web-vitals, frontend-design | yes | yes |
| best-practices-audit | agent | best-practices | best-practices, impeccable | yes | yes |
| trivial-email | agent | none | none | no | yes |
| ask-mode-postgres | ask | postgres-best-practices | postgres-best-practices | yes | yes |
| enabled-subset | agent | accessibility | accessibility | yes | yes |
| rest-api-endpoint | agent | postgres-best-practices | postgres-best-practices | yes | yes |
| nextjs-dashboard | agent | baseline-ui, frontend-design | baseline-ui | yes | yes |
| design-review | agent | impeccable | impeccable, emil-design-eng | yes | yes |
| motion-audit | agent | improve-animations, emil-design-eng | emil-design-eng, improve-animations, apple-design | yes | yes |

## Reproduction

```
node dist/index.js eval evaluation\skill-selection.v1.json
```
