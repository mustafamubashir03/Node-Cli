---
name: react-performance
category: react
sourceRepo: node-cli
sourceUrl: null
license: ISC
tags: ["react", "performance", "composition", "memoization", "rendering"]
triggers: ["react performance", "unnecessary renders", "useMemo", "useCallback", "memo", "component composition", "rerender", "list keys", "profiling"]
contextTokens: 900
---

# React Performance and Composition

Use these practices when optimizing React components.

- Compose components around clear boundaries and reuse; avoid premature abstraction.
- Lift state only as high as needed; keep ephemeral UI state local.
- Profile before optimizing; do not add memo/useMemo/useCallback without measured need.
- Use stable list keys; avoid array indices for dynamic lists.
- Keep render functions pure and avoid creating new objects/arrays in JSX when it causes churn.
- Split expensive subtrees and lazy-load heavy components.
- Preserve readability; optimize only demonstrated bottlenecks.
EOF