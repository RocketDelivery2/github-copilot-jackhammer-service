import { createHash } from "node:crypto";
import type {
  ActiveWorkItem,
  CopilotGuidance,
  CopilotResult,
  RepoSnapshot,
} from "./types.js";

const STATIC_PROMPT_CONTEXT_VERSION = "v1";
const MAX_PACKAGE_HINT_CHARS = 80_000;
const MAX_STATIC_CONTEXT_CACHE_ENTRIES = 12;

export const FEEDBACK_LOOP_PROMPT_POLICY = [
  "Feedback-loop policy:",
  "- Active work first: if there is an active unresolved issue/PR, continue that before starting new work.",
  "- Answer Copilot questions first with direct continuation guidance.",
  "- Failed checks first: prioritize build/test/lint/check failures before feature expansion.",
  "- Prefer small, reviewable, validated PRs with explicit acceptance criteria and test plans.",
  "- Never bypass checks, never include secrets, and avoid unrelated or broad risky rewrites.",
].join("\n");

export const TASK_CREATION_INSTRUCTIONS =
  "You are a senior staff-level engineer producing concise, actionable JackHammer queue GitHub issues for GitHub Copilot coding agent. Select the highest-value next command, enforce industry-standard engineering quality, and keep tasks small, validated, and reviewable. Enforce feedback-loop policy: active work first, answer Copilot questions first, fix failed checks first, then continue with reprioritized queue. Never bypass checks, add secrets, or propose broad unvalidated rewrites. Always return parseable JSON only.";

type PromptContextCacheStats = {
  hits: number;
  misses: number;
};

const promptContextCache = new Map<string, string>();
const promptContextCacheStats: PromptContextCacheStats = {
  hits: 0,
  misses: 0,
};

function digest(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

function normalizePackageHints(packageHints: readonly string[]): string {
  return packageHints.join("\n\n").slice(0, MAX_PACKAGE_HINT_CHARS);
}

function buildStaticContextCacheKey(
  snapshot: RepoSnapshot,
  maxTasksPerRun: number,
): string {
  return JSON.stringify({
    version: STATIC_PROMPT_CONTEXT_VERSION,
    owner: snapshot.owner,
    repo: snapshot.repo,
    baseBranch: snapshot.baseBranch,
    maxTasksPerRun,
    packageHintsDigest: digest(normalizePackageHints(snapshot.packageHints)),
    policyDigest: digest(FEEDBACK_LOOP_PROMPT_POLICY),
  });
}

function pruneCacheIfNeeded(): void {
  while (promptContextCache.size > MAX_STATIC_CONTEXT_CACHE_ENTRIES) {
    const oldestKey = promptContextCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    promptContextCache.delete(oldestKey);
  }
}

function createStaticRepoPolicyContext(
  snapshot: RepoSnapshot,
  maxTasksPerRun: number,
): string {
  return [
    `You are creating the GitHub Copilot JackHammer Service coding-agent issue queue for ${snapshot.owner}/${snapshot.repo} on ${snapshot.baseBranch}.`,
    `Generate up to ${maxTasksPerRun} small, reviewable tasks that GitHub Copilot can implement as independent PRs.`,
    "Only propose tasks supported by the repo context below. Choose the highest-value next Copilot command and prefer proven architecture patterns, efficient algorithms, and clean design.",
    "Apply corporate software engineering standards: correctness, build stability, test coverage, lint/format quality, security, API contract stability, validation/error handling, maintainability, observability, operational safety, rollback safety, and least-risk incremental delivery.",
    "Prefer small testable commands with clear validation steps. Prioritize blockers and reliability work before new feature polish. Never start the next command while active work is unresolved.",
    "Penalize broad risky rewrites, missing tests, branch spam, secrets exposure, bypassing checks, and unrelated changes.",
    'Every copilot_prompt field MUST end with a Notes section containing at minimum "Notes:\\n- None." unless there are real notes.',
    FEEDBACK_LOOP_PROMPT_POLICY,
    'Return strict JSON matching this shape: {"tasks":[...]}. Do not include markdown.',
    `Package/readme hints:\n${normalizePackageHints(snapshot.packageHints)}`,
  ].join("\n");
}

export function clearPromptContextCache(): void {
  promptContextCache.clear();
  promptContextCacheStats.hits = 0;
  promptContextCacheStats.misses = 0;
}

export function getPromptContextCacheStats(): {
  hits: number;
  misses: number;
  size: number;
} {
  return {
    hits: promptContextCacheStats.hits,
    misses: promptContextCacheStats.misses,
    size: promptContextCache.size,
  };
}

export function getStaticRepoPolicyContext(
  snapshot: RepoSnapshot,
  maxTasksPerRun: number,
): string {
  const cacheKey = buildStaticContextCacheKey(snapshot, maxTasksPerRun);
  const cached = promptContextCache.get(cacheKey);
  if (cached) {
    promptContextCacheStats.hits += 1;
    // Move entry to the end of insertion order to keep LRU-like behavior.
    promptContextCache.delete(cacheKey);
    promptContextCache.set(cacheKey, cached);
    return cached;
  }

  promptContextCacheStats.misses += 1;
  const nextValue = createStaticRepoPolicyContext(snapshot, maxTasksPerRun);
  promptContextCache.set(cacheKey, nextValue);
  pruneCacheIfNeeded();
  return nextValue;
}

export function buildGuidanceContext(
  guidance: CopilotGuidance | null,
  recentResults: CopilotResult[],
): string {
  const parts: string[] = [];

  if (guidance) {
    if (guidance.recommendedNextPR) {
      parts.push(`Recommended Next PR from Copilot: ${guidance.recommendedNextPR}`);
    }
    if (guidance.planSteps.length) {
      parts.push(
        `Plan Steps from Copilot:\n${guidance.planSteps.map((step, index) => `${index + 1}. ${step}`).join("\n")}`,
      );
    }
    if (guidance.blockers.length) {
      parts.push(
        `Known blockers (do NOT propose tasks that require these to be resolved first):\n${guidance.blockers.map((blocker) => `- ${blocker}`).join("\n")}`,
      );
    }
    if (guidance.notes.length) {
      parts.push(
        `Notes (future sequencing/caution context only — do NOT implement unless Goal/Tasks explicitly say so):\n${guidance.notes.map((note) => `- ${note}`).join("\n")}`,
      );
    }
  }

  if (recentResults.length) {
    const summary = recentResults
      .slice(0, 5)
      .map(
        (result) =>
          `- #${result.issueNumber} "${result.title}": ${result.outcome} — ${result.summary}`,
      )
      .join("\n");
    parts.push(`Recent Copilot results:\n${summary}`);
  }

  return parts.join("\n\n");
}

export function buildTaskCreationPrompt(input: {
  snapshot: RepoSnapshot;
  compactContext: string;
  guidanceContext: string;
  maxTasksPerRun: number;
}): string {
  const staticContext = getStaticRepoPolicyContext(
    input.snapshot,
    input.maxTasksPerRun,
  );
  return [
    staticContext,
    `Current commit: ${input.snapshot.commitSha}`,
    `Recent git log:\n${input.snapshot.recentChanges}`,
    input.guidanceContext ? `Copilot guidance:\n${input.guidanceContext}` : "",
    `Repo context:\n${input.compactContext}`,
  ]
    .filter((section) => section.length > 0)
    .join("\n\n");
}

export function buildContinuationCommentPrompt(input: {
  activeWork: ActiveWorkItem;
  guidanceContext: string;
  prContext: string;
}): string {
  return `
You are the GitHub Copilot JackHammer Service autopilot continuing work on issue #${input.activeWork.issueNumber}: "${input.activeWork.title}".

${input.prContext ? `Current PR context:\n${input.prContext}\n` : ""}${input.guidanceContext ? `Copilot guidance:\n${input.guidanceContext}\n` : ""}
Copilot has either asked a clarifying question or needs a continuation nudge.
Write a brief, direct continuation comment (2-5 sentences) that:
1. Answers any clarifying question with a clear direction.
2. Instructs Copilot to continue implementing the task as described.
3. References any relevant plan steps or recommended next actions.
4. Does NOT start new work outside the current issue scope.
5. Ends with "Please continue." or a similar direct prompt.

Return only the comment text, no JSON wrapper.
`.trim();
}
