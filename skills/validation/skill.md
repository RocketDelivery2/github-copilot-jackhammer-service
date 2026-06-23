---
name: validation
description: Validate code changes with the standard test, build, and lint sequence and summarize actionable outcomes.
version: 1.0.0
risk: low
allowedTools:
  - npm.cmd
  - git
resourceHints:
  - package.json
  - scripts/run-tests.mjs
keywords:
  - validation
  - test
  - build
  - lint
---

# Validation Skill

Use this skill immediately after source changes.

## Procedure

1. Run `npm.cmd test`.
2. Run `npm.cmd run build`.
3. Run `npm.cmd run lint`.
4. Summarize changed files, failures, and one next repair command when needed.

## Guardrails

- Keep command order deterministic: test, build, lint.
- If a command fails, do not claim completion.
- Include the first failing signal and one concrete next step.
