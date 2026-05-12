import path from 'node:path';
import process from 'node:process';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { config } from './config.js';
import { ensureRepo, snapshotRepo, zipRepo } from './repo.js';
import { createTasks } from './openai.js';
import { createIssue, doctorGithub, ensureLabels, findExistingIssueByHash } from './github.js';
import { taskHash } from './hash.js';
import { loadState, saveState } from './state.js';

const argv = yargs(hideBin(process.argv))
  .option('once', { type: 'boolean', default: false })
  .option('doctor', { type: 'boolean', default: false })
  .parseSync();

const workRoot = path.resolve(process.cwd(), '.work');
const repoDir = path.join(workRoot, `${config.GITHUB_OWNER}-${config.GITHUB_REPO}`);
const statePath = path.resolve(process.cwd(), config.STATE_FILE);
const zipPath = path.resolve(process.cwd(), '.ai', 'jackhammer-repo-main.zip');

function sleep(ms: number) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function doctor() {
  console.log('GitHub Copilot JackHammer Service: checking configuration...');
  console.log(`Repo: ${config.GITHUB_OWNER}/${config.GITHUB_REPO}`);
  console.log(`Branch: ${config.BASE_BRANCH}`);
  console.log(`Dry run: ${config.DRY_RUN}`);
  await doctorGithub();
  console.log('OpenAI key present:', Boolean(config.OPENAI_API_KEY));
  console.log('GitHub Copilot JackHammer Service doctor complete.');
}

async function runOnce() {
  const git = await ensureRepo(repoDir);
  const snapshot = await snapshotRepo(repoDir, git);
  await zipRepo(repoDir, zipPath);
  snapshot.zipPath = zipPath;

  const state = await loadState(statePath);
  if (state.lastCommitSha === snapshot.commitSha) {
    console.log(`No new commit since ${snapshot.commitSha}; still checking for new queue suggestions.`);
  }

  console.log(`Snapshot ${snapshot.commitSha}: ${snapshot.fileCount} files; asking OpenAI for tasks...`);
  const tasks = await createTasks(snapshot, zipPath);
  console.log(`OpenAI proposed ${tasks.length} task(s).`);

  await ensureLabels();
  let created = 0;
  for (const task of tasks) {
    const hash = taskHash(task);
    if (state.createdIssueHashes[hash]) {
      console.log(`Skip duplicate from state: ${task.title}`);
      continue;
    }
    const existing = await findExistingIssueByHash(hash);
    if (existing) {
      console.log(`Skip duplicate on GitHub: ${task.title} -> ${existing.url}`);
      state.createdIssueHashes[hash] = { issueNumber: existing.number, url: existing.url, title: task.title, createdAt: new Date().toISOString() };
      continue;
    }
    if (config.DRY_RUN) {
      console.log(`[DRY RUN] Would create issue: ${task.title}`);
      continue;
    }
    const issue = await createIssue(task, hash, snapshot.commitSha);
    console.log(`Created #${issue.number}: ${issue.url}`);
    state.createdIssueHashes[hash] = { issueNumber: issue.number, url: issue.url, title: task.title, createdAt: new Date().toISOString() };
    created++;
  }
  state.lastCommitSha = snapshot.commitSha;
  await saveState(statePath, state);
  console.log(`GitHub Copilot JackHammer Service run complete. Created ${created} issue(s).`);
}

async function main() {
  if (argv.doctor) return doctor();
  do {
    try { await runOnce(); }
    catch (err) { console.error('Run failed:', err); }
    if (argv.once) break;
    console.log(`Sleeping ${config.POLL_SECONDS}s...`);
    await sleep(config.POLL_SECONDS * 1000);
  } while (true);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
