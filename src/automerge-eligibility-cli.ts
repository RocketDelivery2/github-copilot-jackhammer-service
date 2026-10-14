import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  evaluateUnattendedMerge,
  parseCommitEvidence,
  parseEnabledTaskTypes,
  parsePrEvidence,
  type ManifestEvidence,
  type UnattendedEvaluation,
} from './automerge-eligibility.js';

function readOptional(envName: string): string | undefined {
  const path = process.env[envName];
  return path ? readFileSync(path, 'utf8') : undefined;
}

function blocked(detail: string): UnattendedEvaluation {
  return {
    eligible: false,
    enabled: false,
    taskType: null,
    headSha: null,
    blockers: [`Evidence: ${detail}`],
    gates: [{ name: 'Evidence', allowed: false, detail }],
  };
}

function evaluate(): UnattendedEvaluation {
  const prJson = readOptional('AUTOMERGE_PR_JSON_FILE');
  if (!prJson) return blocked('AUTOMERGE_PR_JSON_FILE is required.');

  const enabled = parseEnabledTaskTypes(process.env.AUTOMERGE_ENABLED_TASK_TYPES);

  const manifestFiles = [
    readOptional('AUTOMERGE_BASE_PACKAGE_JSON_FILE'),
    readOptional('AUTOMERGE_HEAD_PACKAGE_JSON_FILE'),
    readOptional('AUTOMERGE_BASE_LOCKFILE_FILE'),
    readOptional('AUTOMERGE_HEAD_LOCKFILE_FILE'),
  ];
  const manifests: ManifestEvidence | undefined = manifestFiles.every(text => text !== undefined)
    ? {
      basePackageJson: manifestFiles[0]!,
      headPackageJson: manifestFiles[1]!,
      baseLockfile: manifestFiles[2]!,
      headLockfile: manifestFiles[3]!,
    }
    : undefined;
  const commitsJson = readOptional('AUTOMERGE_COMMITS_JSON_FILE');

  const evaluation = evaluateUnattendedMerge(parsePrEvidence(JSON.parse(prJson)), {
    expectedRepository: process.env.AUTOMERGE_EXPECTED_REPO ?? '',
    eventRepository: process.env.AUTOMERGE_EVENT_REPO ?? '',
    expectedHeadSha: process.env.AUTOMERGE_EXPECTED_HEAD_SHA ?? '',
    enabledTaskTypes: enabled.taskTypes,
    manifests,
    commits: commitsJson ? parseCommitEvidence(JSON.parse(commitsJson)) : undefined,
  });

  if (!enabled.valid) {
    return {
      ...evaluation,
      eligible: false,
      enabled: false,
      blockers: [...evaluation.blockers, 'Enabled task types: AUTOMERGE_ENABLED_TASK_TYPES contains an unknown task type.'],
    };
  }
  return evaluation;
}

let result: UnattendedEvaluation;
try {
  result = evaluate();
} catch (error) {
  result = blocked(error instanceof Error ? error.message : String(error));
}

process.stdout.write(`${JSON.stringify(result)}\n`);
