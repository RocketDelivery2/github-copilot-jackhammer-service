export const AUTO_MERGE_POLICY_LABEL = 'auto-merge';

export const AUTO_MERGE_DENY_LABELS = ['security', 'breaking-change', 'do-not-merge'] as const;

export type PullRequestAuthor = {
  login: string;
};

export type PullRequestLabel = {
  name: string;
};

export type AutoMergePolicyInput = {
  number?: number;
  url?: string;
  author: PullRequestAuthor;
  isDraft: boolean;
  labels: readonly PullRequestLabel[];
  reviewDecision: string | null;
  mergeStateStatus: string | null;
};

export type AutoMergePolicyOptions = {
  requirePolicyLabel?: boolean;
  policyLabel?: string;
  approvedBotAuthors?: readonly string[];
};

export type AutoMergePolicyGate = {
  name: string;
  allowed: boolean;
  detail: string;
};

export type AutoMergePolicyEvaluation = {
  allowed: boolean;
  blockers: string[];
  gates: AutoMergePolicyGate[];
};

function normalizeLabelNames(labels: readonly PullRequestLabel[]): string[] {
  return labels
    .map(label => label.name.trim())
    .filter(Boolean);
}

function isBotLogin(login: string): boolean {
  return login.endsWith('[bot]');
}

function isApprovedBotAuthor(login: string, approvedBotAuthors: readonly string[] | undefined): boolean {
  if (approvedBotAuthors && approvedBotAuthors.length > 0) {
    return approvedBotAuthors.includes(login);
  }

  return isBotLogin(login);
}

export function evaluateAutoMergePolicy(
  input: AutoMergePolicyInput,
  options: AutoMergePolicyOptions = {},
): AutoMergePolicyEvaluation {
  const policyLabel = options.policyLabel ?? AUTO_MERGE_POLICY_LABEL;
  const requirePolicyLabel = options.requirePolicyLabel ?? true;
  const approvedBotAuthors = options.approvedBotAuthors;
  const labelNames = normalizeLabelNames(input.labels);
  const denyLabelSet = new Set<string>(AUTO_MERGE_DENY_LABELS);
  const blockers: string[] = [];
  const gates: AutoMergePolicyGate[] = [];

  const addGate = (name: string, allowed: boolean, detail: string): void => {
    gates.push({ name, allowed, detail });
    if (!allowed) {
      blockers.push(`${name}: ${detail}`);
    }
  };

  addGate(
    'Author gate',
    isApprovedBotAuthor(input.author.login, approvedBotAuthors),
    `${input.author.login} is not an approved bot author.`,
  );

  addGate(
    'Policy label gate',
    !requirePolicyLabel || labelNames.includes(policyLabel),
    requirePolicyLabel
      ? `missing required \`${policyLabel}\` policy label.`
      : 'policy label not required.',
  );

  addGate(
    'Draft gate',
    !input.isDraft,
    input.isDraft ? 'PR is still marked draft.' : 'PR is ready for review.',
  );

  const denyLabels = labelNames.filter(label => denyLabelSet.has(label));
  addGate(
    'Policy deny-label gate',
    denyLabels.length === 0,
    denyLabels.length > 0
      ? `blocked labels present: ${denyLabels.join(', ')}.`
      : 'no deny labels present.',
  );

  addGate(
    'Review gate',
    input.reviewDecision === 'APPROVED',
    input.reviewDecision === 'APPROVED'
      ? 'required review approval is present.'
      : `review decision is ${input.reviewDecision ?? 'unknown'}; approval is required.`,
  );

  addGate(
    'Check gate',
    input.mergeStateStatus === 'CLEAN',
    input.mergeStateStatus === 'CLEAN'
      ? 'required status checks are clean.'
      : `merge state is ${input.mergeStateStatus ?? 'unknown'}; required checks still gate merge eligibility.`,
  );

  return {
    allowed: blockers.length === 0,
    blockers,
    gates,
  };
}
