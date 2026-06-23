---
name: typescript-patch
description: Apply a small, reviewable TypeScript change with bounded inspection and deterministic validation.
version: 1.0.0
risk: medium
allowedTools:
  - rg
  - view
  - apply_patch
  - npm.cmd
resourceHints:
  - src/**/*.ts
  - src/**/*.test.ts
  - tsconfig.json
keywords:
  - typescript
  - patch
  - small change
  - bounded inspection
---

# TypeScript Patch Skill

Use this skill for focused TypeScript edits where behavior should remain stable.

## Procedure

1. Inspect relevant symbols first.
2. Bound inspection to only the files and line ranges needed before patching.
3. Apply the smallest coherent patch that satisfies the request.
4. Avoid large rewrites; preserve existing patterns and naming.
5. Validate with:
   - `npm.cmd test`
   - `npm.cmd run build`
   - `npm.cmd run lint`

## Guardrails

- Keep diffs localized and reviewable.
- Do not introduce new dependencies for minor edits.
- Do not change unrelated modules while fixing a targeted issue.
