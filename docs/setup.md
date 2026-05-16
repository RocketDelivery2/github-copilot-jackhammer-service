# JackHammer Service — Setup Guide

> ⚠️ **Public repository.** Never commit `.env`, API keys, tokens, passwords, or any secrets.

---

## 1. Create the JackHammer repo

| Setting | Value |
|---|---|
| Repository name | `github-copilot-jackhammer-service` |
| Visibility | **Public** |
| Initialize README | No |
| Add .gitignore | No |
| Add license | No |

---

## 2. JackHammer repo — GitHub settings

### Settings → General → Features

| Feature | Value |
|---|---|
| Wikis | Off unless wanted |
| Issues | **On** |
| Sponsorships | Off unless used |
| Preserve this repository | Optional |
| Discussions | Off unless wanted |
| Projects | Off unless wanted |
| Pull requests | **On** |

### Settings → General → Pull Requests

| Setting | Value |
|---|---|
| Allow merge commits | Off |
| Allow squash merging | **On** |
| Allow rebase merging | Off |
| Always suggest updating PR branches | **On** |
| Allow auto-merge | Optional |
| Automatically delete head branches | **On** |

### Settings → Actions → General

| Setting | Value |
|---|---|
| Actions permissions | Allow all actions and reusable workflows |
| Workflow permissions | Read repository contents and packages |
| Allow Actions to create and approve PRs | Off unless later needed |

### Settings → Branches → `main` (branch protection rule)

| Setting | Value |
|---|---|
| Require a pull request before merging | **On** |
| Required approvals | 1 (recommended) |
| Dismiss stale PR approvals when new commits pushed | **On** (recommended) |
| Require review from Code Owners | Off unless CODEOWNERS exists |
| Require status checks before merging | **On** |
| Required check | `test-and-build` |
| Require conversation resolution | **On** |
| Require signed commits | Off unless configured |
| Require linear history | Optional |
| Allow force pushes | **Off** |
| Allow deletions | **Off** |

---

## 3. TeamBuilder (serviced repo) — GitHub settings

Target repo: `RocketDelivery2/TeamBuilder`

### Settings → General → Features

| Feature | Value |
|---|---|
| Issues | **On** |
| Pull requests | **On** |
| Projects | Optional |
| Discussions | Optional |
| Wikis | Optional |
| Sponsorships | Off unless used |

### Settings → General → Pull Requests

| Setting | Value |
|---|---|
| Allow merge commits | Off |
| Allow squash merging | **On** |
| Allow rebase merging | Off |
| Always suggest updating PR branches | **On** |
| Allow auto-merge | **On** |
| Automatically delete head branches | **On** |

### Settings → Actions → General

| Setting | Value |
|---|---|
| Actions permissions | Allow all actions and reusable workflows |
| Workflow permissions | **Read and write permissions** |

### Settings → Copilot → Cloud agent

| Setting | Value |
|---|---|
| Copilot cloud agent | **Enabled** |

### Settings → Branches → `main` (branch protection rule)

| Setting | Value |
|---|---|
| Require a pull request before merging | **On** |
| Require approvals | **Off / 0 approvals** (for full automation) |
| Dismiss stale PR approvals when new commits pushed | Off |
| Require review from Code Owners | Off |
| Require approval of the most recent reviewable push | Off |
| Require status checks to pass before merging | **On** |
| Require branches to be up to date before merging | Optional |
| Required checks | Only exact check names that reliably pass |
| Require conversation resolution before merging | Off |
| Require signed commits | Off unless automation signs commits |
| Require linear history | Optional |
| Require deployments to succeed before merging | Off unless deployment is automated |
| Allow force pushes | **Off** |
| Allow deletions | **Off** |

---

## 4. GitHub token permissions

Create a fine-grained PAT scoped to `RocketDelivery2/TeamBuilder`:

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

## 5. Finding the Copilot assignee login

1. Open `RocketDelivery2/TeamBuilder` → Issues → create a temporary test issue.
2. Manually assign **Copilot** to that issue in the GitHub UI.
3. Run:

```bash
gh issue view <issue-number> --repo RocketDelivery2/TeamBuilder --json assignees
```

4. Copy the `login` value into your `.env`:

```dotenv
AUTO_ASSIGN_COPILOT=true
COPILOT_ASSIGNEE=<exact-copilot-agent-login>
```

5. Close/delete the temporary test issue.

---

## 6. Validation

After setting up the repo and `.env`, run:

```bash
npm test
npm run build
npm run lint
```

All three must pass before enabling full autopilot.

---

## 7. Octopus Deploy variables

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

Store all `Sensitive` values as Octopus sensitive variables. Never store them in source control.

---

## 8. Industry standards queue prioritization

The queue-ranking brain and scoring model are documented in [`docs/INDUSTRY_STANDARDS_BRAIN.md`](./INDUSTRY_STANDARDS_BRAIN.md).

---

## 9. ChatGPT-to-Copilot handoff formatting

Raw handoff parsing and canonical Copilot command formatting are documented in [`docs/CHATGPT_HANDOFF_BRAIN.md`](./CHATGPT_HANDOFF_BRAIN.md).

---

## 10. Feedback-loop queue policy

JackHammer should continuously exchange context between ChatGPT/OpenAI and Copilot coding agent: gather latest snapshot, git/PR/check/log context (with recent logs summarized or truncated), generate or refine one Copilot command, add and reprioritize queue, finish active work first (questions and failed checks before new work), then merge/sync and repeat; see [`docs/FEEDBACK_LOOP_QUEUE.md`](./FEEDBACK_LOOP_QUEUE.md).
