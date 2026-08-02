import process from 'node:process';
import {
  AUTO_MERGE_POLICY_LABEL,
  evaluateAutoMergePolicy,
  type AutoMergePolicyInput,
} from './auto-merge-policy.js';

type RawPullRequestContext = {
  author?: { login?: string };
  isDraft?: boolean;
  labels?: Array<{ name?: string }>;
  reviewDecision?: string | null;
  mergeStateStatus?: string | null;
  number?: number;
  url?: string;
};

function parseCsv(value: string | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  const entries = value.split(',').map(entry => entry.trim()).filter(Boolean);
  return entries.length > 0 ? entries : undefined;
}

function loadContext(): AutoMergePolicyInput {
  const raw = process.env.AUTO_MERGE_PR_CONTEXT_JSON;
  if (!raw) {
    throw new Error('AUTO_MERGE_PR_CONTEXT_JSON is required');
  }

  const parsed = JSON.parse(raw) as RawPullRequestContext;
  const authorLogin = parsed.author?.login?.trim();
  if (!authorLogin) {
    throw new Error('PR context is missing author.login');
  }

  return {
    number: parsed.number,
    url: parsed.url,
    author: { login: authorLogin },
    isDraft: Boolean(parsed.isDraft),
    labels: (parsed.labels ?? []).map(label => ({ name: String(label?.name ?? '') })).filter(label => label.name.trim().length > 0),
    reviewDecision: parsed.reviewDecision ?? null,
    mergeStateStatus: parsed.mergeStateStatus ?? null,
  };
}

const evaluation = evaluateAutoMergePolicy(loadContext(), {
  requirePolicyLabel: process.env.AUTO_MERGE_REQUIRE_POLICY_LABEL !== 'false',
  policyLabel: process.env.AUTO_MERGE_POLICY_LABEL ?? AUTO_MERGE_POLICY_LABEL,
  approvedBotAuthors: parseCsv(process.env.AUTO_MERGE_APPROVED_BOT_AUTHORS),
});

process.stdout.write(`${JSON.stringify(evaluation)}\n`);

