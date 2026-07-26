import yargs from 'yargs/yargs';
import { hideBin } from 'yargs/helpers';
import { assertWorkflowGuards, WorkflowGuardError } from './workflow-guards.js';

const argv = yargs(hideBin(process.argv))
  .option('workflow', { type: 'string', demandOption: true })
  .option('allowed-event', { type: 'string', array: true, default: [] })
  .option('required-path', { type: 'string', array: true, default: [] })
  .option('expected-default-branch', { type: 'string' })
  .option('expected-ref-type', { type: 'string' })
  .option('forbidden-ref-name', { type: 'string', array: true, default: [] })
  .parseSync();

async function main(): Promise<void> {
  const expectedRefType = argv['expected-ref-type'];

  await assertWorkflowGuards({
    workflowName: argv.workflow,
    allowedEvents: argv['allowed-event'],
    requiredPaths: argv['required-path'],
    expectedDefaultBranch: argv['expected-default-branch'],
    expectedRefType: expectedRefType === 'branch' || expectedRefType === 'tag' ? expectedRefType : undefined,
    forbiddenRefNames: argv['forbidden-ref-name'],
  });
}

main().catch((error) => {
  if (error instanceof WorkflowGuardError) {
    console.error(error.message);
    process.exitCode = error.exitCode;
    return;
  }

  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
