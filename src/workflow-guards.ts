import fs from 'node:fs/promises';
import path from 'node:path';

export type WorkflowGuardOptions = {
  workflowName: string;
  allowedEvents?: readonly string[];
  expectedDefaultBranch?: string;
  expectedRefType?: 'branch' | 'tag';
  requiredPaths?: readonly string[];
  forbiddenRefNames?: readonly string[];
  cwd?: string;
  eventName?: string;
  eventPath?: string;
  refType?: string;
  refName?: string;
};

export type GithubActionsEventContext = {
  repository?: {
    default_branch?: string;
  };
};

export class WorkflowGuardError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = 'WorkflowGuardError';
  }
}

export async function assertWorkflowGuards(options: WorkflowGuardOptions): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const eventName = options.eventName ?? process.env.GITHUB_EVENT_NAME;
  const refType = options.refType ?? process.env.GITHUB_REF_TYPE;
  const refName = options.refName ?? process.env.GITHUB_REF_NAME;

  if (options.allowedEvents && options.allowedEvents.length > 0) {
    if (!eventName || !options.allowedEvents.includes(eventName)) {
      throw new WorkflowGuardError(
        `${options.workflowName}: unsupported trigger "${eventName ?? 'unknown'}". Allowed triggers: ${options.allowedEvents.join(', ')}.`,
        64,
      );
    }
  }

  if (options.expectedRefType && refType !== options.expectedRefType) {
    throw new WorkflowGuardError(
      `${options.workflowName}: expected ref type "${options.expectedRefType}" but received "${refType ?? 'unknown'}".`,
      64,
    );
  }

  if (options.forbiddenRefNames && refName && options.forbiddenRefNames.includes(refName)) {
    throw new WorkflowGuardError(
      `${options.workflowName}: ref "${refName}" is not allowed for this workflow.`,
      64,
    );
  }

  if (options.expectedDefaultBranch) {
    const eventContext = await readGithubEventContext(options.eventPath ?? process.env.GITHUB_EVENT_PATH);
    const actualDefaultBranch = eventContext.repository?.default_branch;

    if (actualDefaultBranch && actualDefaultBranch !== options.expectedDefaultBranch) {
      throw new WorkflowGuardError(
        `${options.workflowName}: expected default branch "${options.expectedDefaultBranch}" but repository default branch is "${actualDefaultBranch}".`,
        64,
      );
    }
  }

  if (options.requiredPaths && options.requiredPaths.length > 0) {
    for (const relativePath of options.requiredPaths) {
      const absolutePath = path.resolve(cwd, relativePath);
      await fs.access(absolutePath).catch(() => {
        throw new WorkflowGuardError(
          `${options.workflowName}: required path missing: ${relativePath}.`,
          66,
        );
      });
    }
  }
}

export async function readGithubEventContext(eventPath: string | undefined): Promise<GithubActionsEventContext> {
  if (!eventPath) {
    return {};
  }

  try {
    const raw = await fs.readFile(eventPath, 'utf8');
    return JSON.parse(raw) as GithubActionsEventContext;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new WorkflowGuardError(`Unable to read GitHub event payload at ${eventPath}: ${message}`, 64);
  }
}
