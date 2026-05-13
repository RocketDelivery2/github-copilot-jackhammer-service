# JackHammer — Next Steps After Setup

Follow these steps in order to finish setting up and safely run JackHammer.

---

## Step 0 — Pull latest JackHammer main locally

```powershell
cd C:\Users\codin\source\repos\github-copilot-jackhammer-service
git pull origin main
npm install
npm test
npm run build
npm run lint
```

All four commands must pass with no errors before continuing.

---

## Step 1 — Apply repository About metadata

### Preferred (uses the helper script)

```powershell
npm run repo:metadata
```

### Alternative (GitHub CLI)

```powershell
gh repo edit RocketDelivery2/github-copilot-jackhammer-service `
  --description "Long-running TypeScript automation service that uses OpenAI/ChatGPT to generate, rebalance, and drive GitHub Copilot coding-agent issue queues for repo improvement workflows." `
  --homepage "https://github.com/RocketDelivery2/github-copilot-jackhammer-service#readme"
```

See [`docs/REPOSITORY_METADATA.md`](./REPOSITORY_METADATA.md) for recommended topics and full instructions.

---

## Step 2 — Add GitHub Actions CI if missing

The required workflow file is:

```
.github/workflows/test-and-build.yml
```

It is already committed to this repository. It:

- Runs on every `pull_request`
- Runs on every `push` to `main`
- Uses Node.js 20
- Runs `npm ci`
- Runs `npm test`
- Runs `npm run build`
- Runs `npm run lint`
- Exposes a required check named **`test-and-build`**

If the workflow file is missing, re-add it from the repo history or copy the template from the root of this repo.

---

## Step 3 — Protect JackHammer main after CI is green

Configure branch protection in the GitHub UI **after** the CI workflow has run and turned green at least once.

**Repository:** `RocketDelivery2/github-copilot-jackhammer-service`

**Settings → Branches → main:**

| Setting | Value |
|---|---|
| Require a pull request before merging | ✅ On |
| Required approvals | 1 |
| Require status checks to pass | ✅ On |
| Required check name | `test-and-build` (select the exact name GitHub shows) |
| Require conversation resolution before merging | ✅ On |
| Allow force pushes | ❌ Off |
| Allow deletions | ❌ Off |

> **Important:** Branch protection must be configured manually in the GitHub UI. Do not attempt to automate this step unless Administration permissions are explicitly available.

---

## Step 4 — Start safe JackHammer dry run

```powershell
Copy-Item .env.example .env
notepad .env
npm run doctor
$env:DRY_RUN="true"; $env:RUN_ONCE="true"; npm run dev
```

With `DRY_RUN=true`, JackHammer reads the repo and generates a plan but does **not** write any GitHub issues, comments, or PRs.

Review the output carefully before proceeding.

---

## Step 5 — Create one real TeamBuilder queue issue

Once the dry run output looks correct:

```powershell
$env:DRY_RUN="false"; $env:RUN_ONCE="true"; npm run dev
```

This creates exactly **one** real GitHub issue in the configured target repo.

Verify the issue was created correctly before continuing.

---

## Step 6 — Enable Copilot assignment and full autopilot

Only after the single-item flow works end-to-end:

1. Set `AUTO_ASSIGN_COPILOT=true` and `COPILOT_ASSIGNEE=<exact-copilot-agent-login>` in `.env`.
2. Confirm branch protection is green.
3. Confirm CI passes.
4. Then enable full autopilot:

```dotenv
DRY_RUN=false
RUN_ONCE=false
FULL_AUTOPILOT=true
AUTO_ASSIGN_COPILOT=true
AUTO_APPROVE_PR=true
AUTO_MERGE_PR=true
AUTO_DELETE_BRANCH=true
CLOSE_ISSUE_AFTER_MERGE=true
```

---

## Safety reminders

- Never commit `.env`.
- Never commit OpenAI keys, GitHub tokens, Copilot credentials, passwords, or Octopus sensitive values.
- This repository is public. All committed files must be safe for public visibility.
- JackHammer cannot bypass GitHub branch protection, required checks, organization rules, token limits, or missing Copilot cloud-agent access.
