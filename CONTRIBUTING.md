# Contributing to GitHub Copilot JackHammer Service

Thank you for contributing! This document covers the project conventions, automation-generated PR expectations, and safety rules.

---

## Development setup

```bash
npm install
npm test
npm run build
npm run lint
```

All four commands must pass with no errors before opening a PR.

---

## Branch and PR conventions

- Work on a feature branch named `<type>/<short-description>` (e.g. `fix/null-check`, `refactor/extract-constants`).
- Open PRs targeting `main`.
- Keep PRs small and focused. One logical change per PR is strongly preferred.
- Add or update tests for any behaviour change.
- Do not commit `.env`, tokens, API keys, or secrets.

---

## Automation-generated PRs

JackHammer ships several scheduled workflows that automatically open improvement PRs. When you see a PR authored by `github-actions[bot]` with the `automation` and `improvement` labels, expect the following:

### What automated PRs contain

- A clear title matching the task ID from [`.github/improvement-backlog.yml`](./.github/improvement-backlog.yml).
- A description that includes:
  - The task goal and rationale.
  - A checklist of specific steps.
  - A safety section confirming no secrets were introduced.
- Labels: `automation`, `improvement`, `needs-review`.

### Review expectations for automated PRs

1. **All CI checks must pass.** The PR will not merge until `test-and-build` (and any other required checks) are green.
2. **Human review is required.** Automated PRs are never self-approved. A human with write access must review and approve before the PR can merge.
3. **Safe automerge.** After approval, the `safe-automerge` workflow will arm squash automerge if all gates pass. GitHub enforces branch protection independently.
4. **Instruction-only PRs** (where `safe: false` in the backlog) open a branch with a marker file and a PR body containing instructions. A human must implement the changes described.

### Blocking an automated PR

Add any of the following labels to prevent automerge from being armed:
- `do-not-merge`
- `security`
- `breaking-change`

### Disabling the PR bot

Set `enabled: false` for entries in `.github/improvement-backlog.yml`, or remove the `improvement-pr-bot.yml` workflow file.

---

## Continuous improvement workflows

See the [Continuous Improvement Automation](./README.md#continuous-improvement-automation) section in the README for details on:

- Scheduled audit, architecture, and quality review workflows
- How to adjust thresholds and schedules
- How to add or disable backlog entries

---

## Security

- Never commit secrets. All sensitive configuration must use environment variables or GitHub Actions secrets.
- Do not weaken or remove CI gates, tests, or branch protections.
- Report security vulnerabilities privately via [GitHub Security Advisories](https://github.com/RocketDelivery2/github-copilot-jackhammer-service/security/advisories/new).
