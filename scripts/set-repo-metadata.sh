#!/usr/bin/env bash
# set-repo-metadata.sh
# Applies repository metadata to GitHub using the REST API.
# Requires: curl, GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO (from environment or .env).

set -euo pipefail

# Load .env if present (but never overwrite existing env vars).
if [ -f ".env" ]; then
  set -o allexport
  # shellcheck disable=SC1091
  source .env
  set +o allexport
fi

: "${GITHUB_TOKEN:?GITHUB_TOKEN must be set}"
: "${GITHUB_OWNER:?GITHUB_OWNER must be set}"
: "${GITHUB_REPO:?GITHUB_REPO must be set}"

DESCRIPTION="Full-autopilot GitHub Copilot orchestration service (JackHammer) — generates and manages prioritised Copilot coding-agent issue queues."
HOMEPAGE="https://github.com/${GITHUB_OWNER}/${GITHUB_REPO}#readme"
TOPICS='["github-copilot","copilot-agent","jackhammer","ai-automation","issue-queue","full-autopilot","orchestration","openai","devops"]'

echo "Applying metadata to ${GITHUB_OWNER}/${GITHUB_REPO}..."

# Update repo description and homepage.
curl -s -o /dev/null -w "%{http_code}" \
  -X PATCH \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}" \
  -d "{\"description\":\"${DESCRIPTION}\",\"homepage\":\"${HOMEPAGE}\"}" | grep -q "^200$" \
  && echo "  ✓ Description and homepage updated." \
  || echo "  ✗ Failed to update description/homepage (check GITHUB_TOKEN permissions)."

# Replace repository topics.
curl -s -o /dev/null -w "%{http_code}" \
  -X PUT \
  -H "Authorization: Bearer ${GITHUB_TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  "https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/topics" \
  -d "{\"names\":${TOPICS}}" | grep -q "^200$" \
  && echo "  ✓ Topics updated." \
  || echo "  ✗ Failed to update topics (check GITHUB_TOKEN permissions)."

echo "Done."
