import path from 'node:path';
import process from 'node:process';
import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { config } from './config.js';
import { ensureRepo, snapshotRepo, zipRepo } from './repo.js';
import { createTasks, createContinuationComment } from './openai.js';
import {
  createIssue, doctorGithub, ensureLabels, findExistingIssueByHash,
  getIssue, getIssueComments, findLinkedPRs,
  getPR, getPRComments, getPRReviews, getPRChecks,
  allChecksPassed, anyCheckFailed,
  postComment, approvePR, mergePR, closeIssue, deleteBranch,
} from './github.js';
import { taskHash } from './hash.js';
import { loadState, saveState } from './state.js';
import { extractCopilotGuidance, rebalanceQueue, detectCopilotQuestion } from './brain.js';
import type { ActiveWorkItem, CommandQueueItem, CopilotResult, QueueState } from './types.js';
import { applyIndustryStandardsPriority } from './standards.js';

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
  console.log(`Full autopilot: ${config.FULL_AUTOPILOT}`);
  await doctorGithub();
  console.log('OpenAI key present:', Boolean(config.OPENAI_API_KEY));
  console.log('GitHub Copilot JackHammer Service doctor complete.');
}

// ─── Active-work handling ────────────────────────────────────────────────────

/**
 * Handles the current active work item (issue + optional linked PR).
 * Returns true if active work is still in progress; false if it completed/cleared.
 */
async function handleActiveWork(state: QueueState): Promise<boolean> {
  const active = state.activeWorkItem;
  if (!active) return false;

  console.log(`Active work: #${active.issueNumber} "${active.title}"`);

  // Refresh issue state.
  let issue;
  try {
    issue = await getIssue(active.issueNumber);
  } catch {
    console.log(`Issue #${active.issueNumber} not found; clearing active work.`);
    state.activeWorkItem = undefined;
    return false;
  }

  if (issue.state === 'closed') {
    console.log(`Issue #${active.issueNumber} is closed; recording result and clearing active work.`);
    recordResult(state, active, 'merged', 'Issue was closed.');
    state.activeWorkItem = undefined;
    return false;
  }

  // Gather all text from the issue for guidance extraction.
  const issueComments = await getIssueComments(active.issueNumber);
  const allIssueText = [issue.body, ...issueComments].join('\n\n');
  state.extractedCopilotGuidance = extractCopilotGuidance(allIssueText);

  // Find linked PRs if we don't have one yet.
  if (!active.linkedPRNumber) {
    const prs = await findLinkedPRs(active.issueNumber);
    const openPR = prs.find(p => p.state === 'open' && !p.merged);
    if (openPR) {
      active.linkedPRNumber = openPR.number;
      active.linkedPRUrl = openPR.url;
      console.log(`Found linked PR #${openPR.number}: ${openPR.url}`);
    }
  }

  // If we have a linked PR, handle the PR lifecycle.
  if (active.linkedPRNumber) {
    const handled = await handleLinkedPR(state, active);
    return handled;
  }

  // No linked PR yet: check if Copilot is asking a question or needs continuation.
  if (state.extractedCopilotGuidance.hasCopilotQuestion) {
    console.log(`Copilot question detected on issue #${active.issueNumber}; posting continuation comment.`);
    if (!config.DRY_RUN) {
      const comment = await createContinuationComment(active, state.extractedCopilotGuidance, state.recentCopilotResults, '');
      await postComment(active.issueNumber, comment);
    } else {
      console.log('[DRY RUN] Would post continuation comment.');
    }
  } else {
    console.log(`Issue #${active.issueNumber} is open and assigned; waiting for Copilot to create a PR.`);
  }

  return true; // still in progress
}

async function handleLinkedPR(state: QueueState, active: ActiveWorkItem): Promise<boolean> {
  const prNumber = active.linkedPRNumber!;
  let pr;
  try {
    pr = await getPR(prNumber);
  } catch {
    console.log(`PR #${prNumber} not found; clearing linked PR reference.`);
    active.linkedPRNumber = undefined;
    active.linkedPRUrl = undefined;
    return true;
  }

  if (pr.merged) {
    console.log(`PR #${prNumber} already merged; completing active work.`);
    await completeActiveWork(state, active, prNumber, pr.headRef);
    return false;
  }

  if (pr.state === 'closed') {
    console.log(`PR #${prNumber} closed without merge; clearing active work.`);
    recordResult(state, active, 'error', 'PR was closed without merging.');
    state.activeWorkItem = undefined;
    return false;
  }

  // Read PR context for decision-making.
  const [prComments, reviews, checks] = await Promise.all([
    getPRComments(prNumber),
    getPRReviews(prNumber),
    getPRChecks(prNumber),
  ]);

  const prText = [pr.body, ...prComments, ...reviews.map(r => r.body)].join('\n\n');
  const prGuidance = extractCopilotGuidance(prText);

  const hasCopilotQuestion = prGuidance.hasCopilotQuestion || detectCopilotQuestion(prText);
  const checksFailed = anyCheckFailed(checks);
  const checksOk = allChecksPassed(checks);

  if (hasCopilotQuestion || prGuidance.blockers.length > 0) {
    console.log(`Copilot question or blockers detected on PR #${prNumber}; posting continuation.`);
    const prContext = `PR #${prNumber}: ${pr.title}\n${pr.body.slice(0, 2000)}`;
    if (!config.DRY_RUN) {
      const comment = await createContinuationComment(active, state.extractedCopilotGuidance ?? null, state.recentCopilotResults, prContext);
      await postComment(prNumber, comment);
    } else {
      console.log('[DRY RUN] Would post PR continuation comment.');
    }
    recordResult(state, active, 'question', 'Copilot question detected on PR; continuation posted.');
    return true;
  }

  if (checksFailed) {
    console.log(`Checks failed on PR #${prNumber}; notifying Copilot.`);
    const failedNames = checks.filter(c => c.conclusion === 'failure' || c.conclusion === 'error').map(c => c.name);
    if (!config.DRY_RUN) {
      await postComment(prNumber, `@${config.COPILOT_ASSIGNEE || 'copilot'} The following checks have failed: ${failedNames.join(', ')}. Please fix them and push an update.`);
    } else {
      console.log('[DRY RUN] Would post check failure comment.');
    }
    recordResult(state, active, 'error', `Checks failed: ${failedNames.join(', ')}`);
    return true;
  }

  if (!checksOk) {
    console.log(`PR #${prNumber} checks still pending; waiting...`);
    return true;
  }

  // Checks pass — maybe approve and/or merge.
  const canAutoApprove = config.FULL_AUTOPILOT || config.AUTO_APPROVE_PR;
  const canAutoMerge = config.FULL_AUTOPILOT || config.AUTO_MERGE_PR;

  const alreadyApproved = reviews.some(r => r.state === 'APPROVED');
  if (canAutoApprove && !alreadyApproved) {
    await approvePR(prNumber);
  }

  if (canAutoMerge && pr.mergeable !== false) {
    await mergePR(prNumber);
    await completeActiveWork(state, active, prNumber, pr.headRef);
    return false;
  }

  console.log(`PR #${prNumber}: checks pass, awaiting manual merge (FULL_AUTOPILOT/AUTO_MERGE_PR not enabled).`);
  return true;
}

async function completeActiveWork(state: QueueState, active: ActiveWorkItem, prNumber: number, headRef: string): Promise<void> {
  recordResult(state, active, 'merged', `PR #${prNumber} merged successfully.`);

  if (config.FULL_AUTOPILOT || config.AUTO_CLOSE_ISSUE) {
    await closeIssue(active.issueNumber);
  }
  if (config.FULL_AUTOPILOT || config.AUTO_DELETE_BRANCH) {
    await deleteBranch(headRef);
  }
  state.activeWorkItem = undefined;
  console.log(`Active work #${active.issueNumber} completed.`);
}

function recordResult(state: QueueState, active: ActiveWorkItem, outcome: CopilotResult['outcome'], summary: string): void {
  state.recentCopilotResults = [
    { issueNumber: active.issueNumber, title: active.title, outcome, summary, recordedAt: new Date().toISOString() },
    ...state.recentCopilotResults,
  ].slice(0, 20); // keep last 20 results
}

// ─── Main run loop ───────────────────────────────────────────────────────────

async function runOnce(): Promise<void> {
  // 1. Sync repo and build snapshot.
  const git = await ensureRepo(repoDir);
  const snapshot = await snapshotRepo(repoDir, git);
  await zipRepo(repoDir, zipPath);
  snapshot.zipPath = zipPath;

  const state = await loadState(statePath);
  if (state.lastCommitSha === snapshot.commitSha) {
    console.log(`No new commit since ${snapshot.commitSha}; checking active work and queue.`);
  }

  // 2. Active-work-first: handle active work before doing anything else.
  if (state.activeWorkItem) {
    const stillInProgress = await handleActiveWork(state);
    await saveState(statePath, state);
    if (stillInProgress) {
      console.log('Active work still in progress; skipping queue generation this cycle.');
      return;
    }
  }

  // 3. Rebalance existing command queue using latest signals.
  if (state.commandQueue.length > 0) {
    state.commandQueue = rebalanceQueue(state.commandQueue, {
      guidance: state.extractedCopilotGuidance ?? null,
      failedChecks: false,
      hasTests: false,
      hasBuildIssue: false,
      hasLintIssue: false,
      isProductionReady: false,
    });

    // Start the next queue item as the active work.
    const next = state.commandQueue.shift()!;
    if (next.issueNumber) {
      state.activeWorkItem = {
        issueNumber: next.issueNumber,
        issueUrl: next.issueUrl ?? '',
        title: next.title,
        startedAt: new Date().toISOString(),
      };
      console.log(`Starting next queue item: #${next.issueNumber} "${next.title}"`);
      await saveState(statePath, state);
      return;
    }
  }

  // 4. No queue items and no active work: generate new tasks from repo snapshot.
  console.log(`Snapshot ${snapshot.commitSha}: ${snapshot.fileCount} files; asking OpenAI for tasks...`);
  const tasks = await createTasks(
    snapshot,
    zipPath,
    state.extractedCopilotGuidance ?? null,
    state.recentCopilotResults,
  );
  const prioritizedTasks = applyIndustryStandardsPriority(tasks, snapshot);
  console.log(`OpenAI proposed ${tasks.length} task(s); Industry Standards Brain prioritized queue order.`);

  await ensureLabels();
  for (const task of prioritizedTasks) {
  let firstNewIssue: ActiveWorkItem | null = null;

  for (const task of prioritizedTasks) {
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

    const queueItem: CommandQueueItem = {
      hash,
      title: task.title,
      priority: task.priority,
      issueNumber: issue.number,
      issueUrl: issue.url,
      prompt: task.copilot_prompt,
    };

    if (!firstNewIssue) {
      // The first new issue becomes the active work item immediately.
      firstNewIssue = {
        issueNumber: issue.number,
        issueUrl: issue.url,
        title: task.title,
        startedAt: new Date().toISOString(),
      };
    } else {
      state.commandQueue.push(queueItem);
    }
  }

  if (firstNewIssue) {
    state.activeWorkItem = firstNewIssue;
    console.log(`Active work set to #${firstNewIssue.issueNumber} "${firstNewIssue.title}"`);
  }

  state.lastCommitSha = snapshot.commitSha;
  await saveState(statePath, state);
  console.log(`GitHub Copilot JackHammer Service run complete.`);
}

async function main() {
  if (argv.doctor) return doctor();

  const startTime = Date.now();
  const maxMs = config.MAX_RUNTIME_HOURS * 60 * 60 * 1000;

  do {
    if (Date.now() - startTime > maxMs) {
      console.log(`MAX_RUNTIME_HOURS (${config.MAX_RUNTIME_HOURS}h) reached; exiting.`);
      break;
    }
    try { await runOnce(); }
    catch (err) { console.error('Run failed:', err); }
    if (argv.once || config.RUN_ONCE) break;
    console.log(`Sleeping ${config.POLL_SECONDS}s...`);
    await sleep(config.POLL_SECONDS * 1000);
  } while (true);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
