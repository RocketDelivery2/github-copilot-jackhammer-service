# GitHub Copilot JackHammer Service

**GitHub Copilot JackHammer Service** is a long-running repo automation service that turns current code context into ChatGPT-generated GitHub issues suitable for GitHub Copilot coding agent review.

It implements this safe flow:

```text
OpenAI/ChatGPT reads repo context
  -> creates scoped task specs
  -> service creates GitHub issues labeled ai-task/jackhammer-queue
  -> optional Copilot assignment if your repo supports it
  -> Copilot or developer opens PR
  -> human reviews and merges
```

## What this does not do

It does **not** paste into the Copilot Chat UI, steal browser sessions, or bypass GitHub Copilot licensing. Use a `GITHUB_TOKEN` with repo issue permissions and enable GitHub Copilot coding agent/cloud agent on the repository if you want Copilot assignment.

## Quick start

```bash
cp .env.example .env
npm install
npm run doctor
npm run once
npm run dev
```

## Required GitHub token permissions

For a fine-grained PAT, grant access to the target repo with:

- Issues: read/write
- Metadata: read
- Pull requests: read
- Contents: read

If you want the service to push queue files later, also grant Contents read/write. This version creates issues only by default.

## Optional Copilot assignment

GitHub Copilot coding agent starts automatically when Copilot is assigned to an issue in a repo where the cloud agent is enabled. GitHub has changed the underlying assignee/login behavior over time, so this service leaves `COPILOT_ASSIGNEE` blank by default. If your repo exposes an assignable login such as a Copilot agent account, set it in `.env`.

Without `COPILOT_ASSIGNEE`, the service still creates high-quality Copilot-ready issues with the label `jackhammer-queue` for you to assign manually.

## Running forever

Use Docker, pm2, systemd, or a long-running terminal session.

```bash
npm run dev
```

The GitHub Copilot JackHammer daemon sleeps for `POLL_SECONDS`, pulls the latest `BASE_BRANCH`, builds a repo context snapshot, asks OpenAI for the next tasks, and creates new GitHub issues if they are not duplicates.

## Safety controls

- Deduplicates by deterministic task hash.
- Excludes `.git`, `node_modules`, build output, env files, locks, media, and large binaries.
- Limits context by `MAX_CONTEXT_FILES` and `MAX_CONTEXT_BYTES`.
- Supports `DRY_RUN=true`.
- Never auto-merges PRs.


## Branding

This project is intentionally named **GitHub Copilot JackHammer Service** throughout package metadata, generated issue bodies, labels, queue paths, and systemd service names.
