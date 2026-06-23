---
name: repo-inspection
description: Inspect repository state safely with bounded, targeted reads before deciding to patch, ask, or stop.
version: 1.0.0
risk: low
allowedTools:
  - git
  - rg
  - glob
  - view
resourceHints:
  - src/
  - docs/
  - package.json
keywords:
  - inspect
  - repository
  - diff
  - bounded reads
---

# Repo Inspection Skill

Use this skill when you need to understand existing code or repo state before editing.

## Procedure

1. Start with repository state: `git --no-pager status` and `git --no-pager diff --stat`.
2. Use symbol/keyword search (`rg`, `glob`) to narrow to likely files.
3. Read targeted line windows, not full files, unless file size is clearly small and full context is required.
4. Prefer `view_range` on large files and inspect only the sections needed to decide.
5. After 2-3 inspection commands, patch, ask, or stop.

## Guardrails

- Do not use full-file Get-Content -Raw on large files by default.
- Do not dump unrelated files.
- Do not keep re-running equivalent search commands without changing strategy.
- If no confident path appears after bounded inspection, stop and report uncertainty.
