# GitHub Copilot JackHammer Service

> ⚠️ **Public repository.** Never commit `.env`, OpenAI keys, GitHub tokens, passwords, Copilot credentials, logs containing secrets, or Octopus sensitive values. Use Octopus sensitive variables or local environment variables for all secrets.

**GitHub Copilot JackHammer Service** is a long-running repo automation service that uses OpenAI/ChatGPT to read a live codebase snapshot, generate or rebalance a prioritized Copilot command queue, and then drive GitHub Copilot coding agent end-to-end — from issue creation through PR approval, merge, branch deletion, and issue close.

It starts in **safe mode** (`DRY_RUN=true`) and supports optional **full autopilot** when explicitly configured.

---

## How it works

```text
OpenAI/ChatGPT reads the latest repo snapshot
  -> generates or rebalances a prioritized Copilot command queue
  -> JackHammer creates one GitHub issue at a time
  -> optionally assigns Copilot coding agent (AUTO_ASSIGN_COPILOT=true)
  -> waits for Copilot PR / checks / comments / questions
  -> sends blockers, questions, and logs back to ChatGPT
  -> posts continuation instructions back to Copilot
  -> approves, merges, closes issue, and deletes feature branch if configured
  -> syncs main
  -> uploads latest codebase snapshot
  -> starts the next queue item
```

---

## Safety controls

- Deduplicates issues by deterministic task hash.
- Excludes `.git`, `node_modules`, build output, env files, lock files, media, and large binaries.
- Limits context by `MAX_CONTEXT_FILES` and `MAX_CONTEXT_BYTES`.
- Supports `DRY_RUN=true` (default) — no GitHub writes occur.
- **By default, JackHammer starts in safe mode with `DRY_RUN=true` and does not merge PRs.**
- When `FULL_AUTOPILOT=true`, `AUTO_MERGE_PR=true`, and GitHub permissions allow it, JackHammer can approve, merge, close issues, and delete feature branches automatically.
- **JackHammer cannot bypass GitHub branch protection, required checks, organization rules, token limits, or missing Copilot cloud-agent access.**

---

## Quick start

```bash
cp .env.example .env
# edit .env with your keys and repo details
npm install
npm run doctor
npm run once
npm run dev
```

---

## Next steps after cloning

See [`docs/NEXT_STEPS.md`](./docs/NEXT_STEPS.md) for the full ordered workflow:

1. Pull latest main and validate locally (`npm install`, `npm test`, `npm run build`, `npm run lint`)
2. Apply repository About metadata (`npm run repo:metadata`)
3. Add GitHub Actions CI (`.github/workflows/test-and-build.yml`)
4. Configure branch protection after CI is green
5. Start a safe dry run (`DRY_RUN=true`)
6. Create one real queue issue (`DRY_RUN=false`, `RUN_ONCE=true`)
7. Enable Copilot assignment and full autopilot only after the single-item flow works

---

## Environment variables

See [`.env.example`](./.env.example) for the full reference.

### Safe dry-run (default)

```dotenv
OPENAI_API_KEY=sk-your-openai-api-key
OPENAI_MODEL=gpt-5.2
GITHUB_TOKEN=github_pat_your-token
GITHUB_OWNER=RocketDelivery2
GITHUB_REPO=TeamBuilder
REPO_URL=https://github.com/RocketDelivery2/TeamBuilder.git
BASE_BRANCH=main
DRY_RUN=true
RUN_ONCE=true
FULL_AUTOPILOT=false
AUTO_ASSIGN_COPILOT=false
COPILOT_ASSIGNEE=
AUTO_APPROVE_PR=false
AUTO_MERGE_PR=false
AUTO_DELETE_BRANCH=false
CLOSE_ISSUE_AFTER_MERGE=false
COMMENT_ON_COPILOT_QUESTIONS=true
BRAIN_FALLBACK_ENABLED=true
MAX_RUNTIME_HOURS=24
MERGE_METHOD=squash
```

### Full autopilot

```dotenv
DRY_RUN=false
RUN_ONCE=false
FULL_AUTOPILOT=true
AUTO_ASSIGN_COPILOT=true
AUTO_APPROVE_PR=true
AUTO_MERGE_PR=true
AUTO_DELETE_BRANCH=true
CLOSE_ISSUE_AFTER_MERGE=true
COMMENT_ON_COPILOT_QUESTIONS=true
BRAIN_FALLBACK_ENABLED=true
MAX_RUNTIME_HOURS=24
LOOP_INTERVAL_SECONDS=120
PR_POLL_SECONDS=90
MAX_CONTINUATIONS_PER_ITEM=8
MERGE_METHOD=squash
```

---

## GitHub token permissions

Fine-grained PAT scoped to `RocketDelivery2/TeamBuilder`:

| Permission | Level |
|---|---|
| Actions | Read |
| Checks | Read |
| Commit statuses | Read |
| Contents | Read and Write |
| Issues | Read and Write |
| Metadata | Read-only |
| Pull requests | Read and Write |
| Administration *(optional)* | Read and Write |

---

## Finding the Copilot assignee login

1. Create a temporary issue in `RocketDelivery2/TeamBuilder`.
2. Manually assign it to **Copilot** in the GitHub UI.
3. Run:

```bash
gh issue view <issue-number> --repo RocketDelivery2/TeamBuilder --json assignees
```

4. Copy the returned `login` value into your `.env`:

```dotenv
AUTO_ASSIGN_COPILOT=true
COPILOT_ASSIGNEE=<exact-copilot-agent-login>
```

---

## Behaviour notes

### Brain fallback (`BRAIN_FALLBACK_ENABLED`)

When enabled, if ChatGPT does not return a parseable next action or the queue is empty, the service falls back to re-reading the full repo snapshot and regenerating the queue from scratch rather than halting.

### Plan steps parsing

The service parses numbered `Plan Steps` blocks from the ChatGPT response body. Each step becomes a candidate queue item. Steps are deduplicated by hash before being written to GitHub Issues.

### Recommended Next PR parsing

If the ChatGPT response includes a `Recommended Next PR` section, the service promotes that item to the front of the queue for the current run.

### Notes section behaviour

`Notes:` in a generated Copilot command are for future sequencing guidance, cautions, blockers, and context that Copilot should **not** implement unless the `Goal` or `Tasks` sections explicitly say so. Every generated command includes at minimum:

```
Notes:
- None.
```

### ChatGPT-to-Copilot command translation

The service translates ChatGPT plan output into structured Copilot issue bodies using the canonical format:

```
Goal: <one-line summary>

Tasks:
- <step 1>
- <step 2>

Notes:
- None.
```

### Octopus Deploy variable support

All sensitive configuration can be injected via Octopus Deploy variables at deploy/run time instead of a `.env` file. See the [Octopus variables](#octopus-deploy-variables) section below.

---

## Copilot command example

```
Goal: Add input validation to the registration form.

Tasks:
- Validate that the email field is non-empty and matches RFC 5322 format.
- Validate that the password field meets the minimum length requirement.
- Return a 400 response with a descriptive error message on validation failure.
- Add unit tests for each validation rule.

Notes:
- None.
```

---

## Running forever

```bash
npm run dev
```

Or use Docker, pm2, or systemd. The service loops, sleeping for `LOOP_INTERVAL_SECONDS` between queue items.

---

## Uploading to GitHub (Windows PowerShell)

If starting from a downloaded ZIP:

```powershell
cd "$env:USERPROFILE\Downloads"
Expand-Archive .\github-copilot-jackhammer-service.zip -DestinationPath .\github-copilot-jackhammer-service -Force
cd .\github-copilot-jackhammer-service
npm install
npm test
npm run build
npm run lint
git init
git add .
git commit -m "Initial GitHub Copilot JackHammer Service"
git branch -M main
git remote add origin https://github.com/RocketDelivery2/github-copilot-jackhammer-service.git
git push -u origin main
```

If origin already exists:

```powershell
git remote set-url origin https://github.com/RocketDelivery2/github-copilot-jackhammer-service.git
git push -u origin main
```

---

## Octopus Deploy variables

| Variable | Value / Sensitivity |
|---|---|
| `JackHammer.OpenAI.ApiKey` | **Sensitive** |
| `JackHammer.OpenAI.Model` | `gpt-5.2` |
| `JackHammer.GitHub.Token` | **Sensitive** |
| `JackHammer.GitHub.Owner` | `RocketDelivery2` |
| `JackHammer.GitHub.Repo` | `TeamBuilder` |
| `JackHammer.GitHub.RepoUrl` | `https://github.com/RocketDelivery2/TeamBuilder.git` |
| `JackHammer.GitHub.BaseBranch` | `main` |
| `JackHammer.Copilot.Assignee` | `<exact-copilot-agent-login>` |
| `JackHammer.FullAutopilot` | `true` |
| `JackHammer.DryRun` | `false` |
| `JackHammer.RunOnce` | `false` |
| `JackHammer.MaxRuntimeHours` | `24` |
| `JackHammer.MergeMethod` | `squash` |

---

## Branding

This project is intentionally named **GitHub Copilot JackHammer Service** throughout package metadata, generated issue bodies, labels, queue paths, and systemd service names.

---

## Further setup documentation

See [`docs/setup.md`](./docs/setup.md) for:
- Full JackHammer repo GitHub settings
- Full TeamBuilder (serviced repo) GitHub settings
- Validation steps

See [`docs/INDUSTRY_STANDARDS_BRAIN.md`](./docs/INDUSTRY_STANDARDS_BRAIN.md) for:
- Industry standards used by queue scoring
- How candidate Copilot commands are ranked and rebalanced
- Backend-first and frontend-scale sequencing strategy

See [`docs/CHATGPT_HANDOFF_BRAIN.md`](./docs/CHATGPT_HANDOFF_BRAIN.md) for:
- How raw ChatGPT/Copilot/terminal handoff input is converted into one canonical Copilot command
- How exclusions, validation steps, and merge/sync instructions are preserved
- README-only docs PR handoff examples

See [`docs/FEEDBACK_LOOP_QUEUE.md`](./docs/FEEDBACK_LOOP_QUEUE.md) for:
- The continuous context exchange loop between ChatGPT/OpenAI and Copilot coding agent
- Active-work-first queue behavior and continuation policy
- Prompt contract expectations for concise logs and paste-ready commands
