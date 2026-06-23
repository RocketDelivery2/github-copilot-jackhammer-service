---
name: error-recovery
description: Recover from command failure by classifying the error and emitting one concrete repair command without retry loops.
version: 1.0.0
risk: medium
allowedTools:
  - npm.cmd
  - node
  - powershell
resourceHints:
  - command output logs
  - scripts/
keywords:
  - error
  - failure
  - repair
  - recovery
---

# Error Recovery Skill

Use this skill when a command fails and the previous strategy is no longer reliable.

## Procedure

1. Classify the failure category: syntax/quoting, type error, missing import, test assertion, or environment issue.
2. Extract the first actionable error from stderr/stdout.
3. Produce exactly one next repair command.
4. Avoid repeating the same broken command form.
5. Prefer here-string or temp-file scripts over fragile node -e quoting for multiline patches.

## Guardrails

- Do not output multiple competing repair commands.
- Do not loop on the same failing command with no strategy change.
- If the error is ambiguous, output one diagnostic command before any patch attempt.
