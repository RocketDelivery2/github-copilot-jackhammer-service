export type RepoFile = {
  path: string;
  bytes: number;
  content: string;
};

export type RepoSnapshot = {
  owner: string;
  repo: string;
  baseBranch: string;
  commitSha: string;
  generatedAt: string;
  fileCount: number;
  files: RepoFile[];
  recentChanges: string;
  packageHints: string[];
  zipPath?: string;
};

export type AiTask = {
  title: string;
  priority: 'low' | 'medium' | 'high';
  type: 'bug' | 'feature' | 'refactor' | 'test' | 'docs' | 'security' | 'maintenance';
  summary: string;
  target_files: string[];
  copilot_prompt: string;
  acceptance_criteria: string[];
  test_plan: string[];
  risk_notes: string[];
};

export type QueueState = {
  createdIssueHashes: Record<string, { issueNumber: number; url: string; title: string; createdAt: string }>;
  lastCommitSha?: string;
};
