import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeFileContent,
  renderIssueBody,
  renderPrComment,
} from '../best-practices-reviewer.js';

describe('best-practices-reviewer', () => {
  it('flags high-confidence code smells and format drift', () => {
    const findings = analyzeFileContent(
      'src/sample.ts',
      [
        'export function example(value: any) {',
        '\t// TODO cleanup',
        '  // @ts-ignore',
        '  return value;  ',
        '}',
      ].join('\n'),
    );

    const titles = findings.map((finding) => finding.title);
    assert.ok(titles.includes('Type safety gap from any usage'));
    assert.ok(titles.includes('Suppressed type error'));
    assert.ok(titles.includes('Outstanding technical-debt marker'));
    assert.ok(titles.includes('Trailing whitespace'));
    assert.ok(titles.includes('Tab indentation drift'));
  });

  it('renders issue and PR output from structured report', () => {
    const findings = analyzeFileContent(
      'src/scan.ts',
      'export const value: any = 1;',
    );

    const report = {
      verdict: 'needs-work' as const,
      generatedAt: '2026-01-01T00:00:00.000Z',
      summary: {
        totalFindings: findings.length,
        blocking: 0,
        warnings: findings.length,
        info: 0,
        scannedFiles: 1,
      },
      findings,
      safeImmediateFixes: [],
      followUpTasks: [
        {
          title: '[Best Practices] Type safety hardening',
          priority: 'medium' as const,
          body: 'Replace `any` with explicit types.',
        },
      ],
    };

    const prComment = renderPrComment(report);
    const issueBody = renderIssueBody(report);

    assert.ok(prComment.includes('## Best-practices reviewer'));
    assert.ok(issueBody.includes('# Best-practices reviewer follow-up'));
    assert.ok(issueBody.includes('Type safety hardening'));
  });
});
