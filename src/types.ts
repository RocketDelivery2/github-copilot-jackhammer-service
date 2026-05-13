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

export type ActiveWorkItem = {
  issueNumber: number;
  issueUrl: string;
  title: string;
  linkedPRNumber?: number;
  linkedPRUrl?: string;
  startedAt: string;
};

export type CommandQueueItem = {
  hash: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  issueNumber?: number;
  issueUrl?: string;
  prompt: string;
};

export type CopilotGuidance = {
  planSteps: string[];
  recommendedNextPR: string | null;
  notes: string[];
  validation: string[];
  blockers: string[];
  errors: string[];
  hasCopilotQuestion: boolean;
  rawText: string;
  extractedAt: string;
};

export type CopilotResult = {
  issueNumber: number;
  title: string;
  outcome: 'merged' | 'question' | 'error' | 'blocked' | 'pending';
  summary: string;
  recordedAt: string;
};

export type QueueState = {
  createdIssueHashes: Record<string, { issueNumber: number; url: string; title: string; createdAt: string }>;
  lastCommitSha?: string;
  activeWorkItem?: ActiveWorkItem;
  commandQueue: CommandQueueItem[];
  extractedCopilotGuidance?: CopilotGuidance;
  recentCopilotResults: CopilotResult[];
};
