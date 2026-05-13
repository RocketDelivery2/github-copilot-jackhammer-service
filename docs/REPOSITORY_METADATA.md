# Repository Metadata

## Overview

This document describes the metadata for the **GitHub Copilot JackHammer Service** repository.

## Package Metadata

| Field       | Value                                                                           |
|-------------|---------------------------------------------------------------------------------|
| Name        | `github-copilot-jackhammer-service`                                             |
| Version     | `0.1.0`                                                                         |
| Description | Full-autopilot GitHub Copilot orchestration service (JackHammer) — generates and manages prioritised Copilot coding-agent issue queues, handles active-work continuation, PR lifecycle, and queue rebalancing. |
| Homepage    | `https://github.com/RocketDelivery2/github-copilot-jackhammer-service#readme`   |
| Repository  | `https://github.com/RocketDelivery2/github-copilot-jackhammer-service`          |
| Bugs        | `https://github.com/RocketDelivery2/github-copilot-jackhammer-service/issues`  |
| License     | UNLICENSED (private)                                                            |

## Keywords

- `github-copilot`
- `copilot-agent`
- `jackhammer`
- `ai-automation`
- `issue-queue`
- `full-autopilot`
- `orchestration`
- `openai`
- `devops`

## GitHub Repository Settings

The following GitHub repository metadata should be configured via the `repo:metadata` npm script or via the GitHub UI:

| Setting     | Value                                                   |
|-------------|---------------------------------------------------------|
| Description | Full-autopilot GitHub Copilot orchestration service     |
| Website     | `https://github.com/RocketDelivery2/github-copilot-jackhammer-service#readme` |
| Topics      | `github-copilot`, `ai-automation`, `jackhammer`, `openai`, `devops` |

## Updating Metadata

Run the following to apply repository metadata via the GitHub API:

```bash
npm run repo:metadata
```

This requires a `GITHUB_TOKEN` with `repo` scope (or read the `.env.example` for guidance).
The script reads `GITHUB_OWNER`, `GITHUB_REPO`, and `GITHUB_TOKEN` from environment variables or `.env`.
