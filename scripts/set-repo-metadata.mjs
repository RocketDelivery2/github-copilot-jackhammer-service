import 'dotenv/config';

function requireEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} must be set`);
  }

  return value;
}

function buildHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function updateMetadata(owner, repo, token) {
  const description = 'Full-autopilot GitHub Copilot orchestration service (JackHammer) — generates and manages prioritised Copilot coding-agent issue queues.';
  const homepage = `https://github.com/${owner}/${repo}#readme`;
  const topics = ['github-copilot', 'copilot-agent', 'jackhammer', 'ai-automation', 'issue-queue', 'full-autopilot', 'orchestration', 'openai', 'devops'];
  const headers = buildHeaders(token);

  console.log(`Applying metadata to ${owner}/${repo}...`);

  const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    method: 'PATCH',
    headers,
    body: JSON.stringify({ description, homepage }),
  });

  if (!repoResponse.ok) {
    throw new Error(`Failed to update description/homepage: ${repoResponse.status} ${repoResponse.statusText}`);
  }
  console.log('  ✓ Description and homepage updated.');

  const topicsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/topics`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({ names: topics }),
  });

  if (!topicsResponse.ok) {
    throw new Error(`Failed to update topics: ${topicsResponse.status} ${topicsResponse.statusText}`);
  }
  console.log('  ✓ Topics updated.');
  console.log('Done.');
}

async function main() {
  const token = requireEnv('GITHUB_TOKEN');
  const owner = requireEnv('GITHUB_OWNER');
  const repo = requireEnv('GITHUB_REPO');
  await updateMetadata(owner, repo, token);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
