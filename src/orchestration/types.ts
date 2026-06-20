export type WorkItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'skipped';

export type ParsedCommandKind =
  | 'shell_command'
  | 'agent_command'
  | 'validation'
  | 'conversation'
  | 'research';

export type WorkItemKind =
  | ParsedCommandKind
  | 'fix'
  | 'feature'
  | 'refactor'
  | 'docs'
  | 'maintenance';

export type WorkItemPriority = 'low' | 'medium' | 'high' | 'urgent';

export type WorkItem = {
  id: string;
  title: string;
  kind: WorkItemKind;
  status: WorkItemStatus;
  priority?: WorkItemPriority;
  description?: string;
  command?: string;
  dependsOn?: string[];
  readPaths?: string[];
  writePaths?: string[];
  worktree?: string;
  isBarrier?: boolean;
};

export type ExecutionEventKind =
  | 'started'
  | 'stdout'
  | 'stderr'
  | 'exit'
  | 'completed'
  | 'failed';

export type ExecutionEvent = {
  workItemId: string;
  kind: ExecutionEventKind;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  message?: string;
};

export type QueueSignalKind =
  | 'build_failure'
  | 'test_failure'
  | 'lint_failure'
  | 'agent_question'
  | 'missing_tests'
  | 'needs_research'
  | 'needs_architect_decision'
  | 'urgent'
  | 'blocker';

export type QueueSignalSeverity = 'info' | 'warning' | 'error';

export type QueueSignal = {
  kind: QueueSignalKind;
  severity: QueueSignalSeverity;
  message: string;
  workItemId?: string;
  targetItemId?: string;
  evidence?: string;
};

export type ConversationKind =
  | 'agent_question'
  | 'missing_tests'
  | 'needs_research'
  | 'needs_architect_decision'
  | 'blocked';

export type SchedulerDecision =
  | {
      kind: 'run';
      workItemIds: string[];
      reason: string;
    }
  | {
      kind: 'wait';
      workItemIds: string[];
      reason: string;
    }
  | {
      kind: 'create_conversation';
      workItemIds: string[];
      conversationKind: ConversationKind;
      reason: string;
    }
  | {
      kind: 'blocked';
      workItemIds: string[];
      reason: string;
    };

export type ParallelismDecision = {
  canRun: boolean;
  reason: string;
  conflicts: string[];
};
