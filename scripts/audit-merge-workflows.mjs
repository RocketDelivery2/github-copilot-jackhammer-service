import { readFile } from 'node:fs/promises';

const mergeGuard = /^steps\.gates\.outputs\.(gate_pass|do_arm)\s*==\s*(['"])true\2$/;

const failClosedDoArm = /DO_ARM=false[\s\S]*?if \[\s*"\$GATE_PASS"\s*=\s*"true"\s*\] && \[\s*"\$AUTO_MERGE_ENABLED"\s*!=\s*"true"\s*\]; then\s+DO_ARM=true\s+fi[\s\S]*?echo "do_arm=\$DO_ARM"/;

function inspectWorkflow(source) {
  const steps = [];
  let step;

  for (const line of source.split(/\r?\n/)) {
    if (/^      - /.test(line)) {
      if (step) steps.push(step);
      step = { mergeCount: 0 };
    }

    if (!step) continue;

    const condition = line.match(/^\s*if:\s*(.*?)\s*$/)?.[1];
    const guardOutput = condition?.match(mergeGuard)?.[1];
    if (guardOutput) {
      step.guardOutput = guardOutput;
    }

    const command = line.trim().replace(/^run:\s*/, '');
    if (/\bgh\s+pr\s+merge\b/.test(command)) {
      step.mergeCount += 1;
    }
  }

  if (step) steps.push(step);

  const mergeCount = steps.reduce((total, item) => total + item.mergeCount, 0);
  const guardedMergeCount = steps.reduce(
    (total, item) => total + (item.guardOutput ? item.mergeCount : 0),
    0,
  );

  return {
    hasDenyLabels: /security|breaking-change|do-not-merge/i.test(source),
    hasSummary: /\$GITHUB_STEP_SUMMARY|summary/i.test(source),
    hasFailClosedDoArm: (source.match(/\bDO_ARM\s*=\s*true\b/g) ?? []).length === 1
      && failClosedDoArm.test(source),
    mergeCount,
    guardedMergeCount,
    usesDoArm: steps.some(item => item.guardOutput === 'do_arm' && item.mergeCount > 0),
  };
}

async function auditWorkflow(file) {
  let source;
  try {
    source = await readFile(file, 'utf8');
  } catch {
    console.log(`- FAIL: ${file} missing`);
    return false;
  }

  const result = inspectWorkflow(source);
  const guardPass = result.mergeCount > 0 && result.guardedMergeCount === result.mergeCount;
  const unconditionalPass = result.guardedMergeCount === result.mergeCount;
  const authorizationPass = !result.usesDoArm || result.hasFailClosedDoArm;

  console.log(
    `- ${result.hasDenyLabels ? 'PASS' : 'FAIL'}: ${file} deny-label blocking ${result.hasDenyLabels ? 'present' : 'missing'}`,
  );
  console.log(
    `- ${guardPass ? 'PASS' : 'FAIL'}: ${file} guarded merge execution path ${guardPass ? 'present' : 'missing'} (merge_count=${result.mergeCount} guard_count=${result.guardedMergeCount})`,
  );
  console.log(
    `- ${result.hasSummary ? 'PASS' : 'FAIL'}: ${file} step-summary logging ${result.hasSummary ? 'present' : 'missing'}`,
  );
  console.log(
    `- ${unconditionalPass ? 'PASS' : 'FAIL'}: ${file} ${unconditionalPass ? 'has no' : 'has potential'} unconditional merge path (merge_count=${result.mergeCount} guard_count=${result.guardedMergeCount})`,
  );
  if (result.usesDoArm) {
    console.log(
      `- ${authorizationPass ? 'PASS' : 'FAIL'}: ${file} derived do_arm output ${authorizationPass ? 'is fail-closed' : 'is not fail-closed'}`,
    );
  }

  return result.hasDenyLabels && guardPass && result.hasSummary && unconditionalPass && authorizationPass;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: node scripts/audit-merge-workflows.mjs <workflow.yml> [...]');
  process.exitCode = 2;
} else {
  const results = [];
  for (const file of files) {
    results.push(await auditWorkflow(file));
  }
  if (results.some(result => !result)) {
    process.exitCode = 1;
  }
}
