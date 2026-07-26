import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  analyzeAlgorithmFindings,
  renderAlgorithmReviewMarkdown,
} from '../algorithm-performance-reviewer.js';

describe('algorithm-performance-reviewer', () => {
  it('detects array membership scans inside loops', () => {
    const findings = analyzeAlgorithmFindings(
      [
        'const selected: string[] = [];',
        'for (const id of ids) {',
        '  if (selected.includes(id)) {',
        '    continue;',
        '  }',
        '}',
      ].join('\n'),
      'C:\\repo\\src\\example.ts',
      'C:\\repo',
    );

    assert.ok(findings.some(finding => finding.patternId === 'array_includes_in_loop'));
  });

  it('detects nested loops', () => {
    const findings = analyzeAlgorithmFindings(
      [
        'for (const row of rows) {',
        '  for (const cell of cells) {',
        '    doWork(row, cell);',
        '  }',
        '}',
      ].join('\n'),
      'C:\\repo\\src\\nested.ts',
      'C:\\repo',
    );

    assert.ok(findings.some(finding => finding.patternId === 'nested_loop'));
  });

  it('does not flag Set.has usage as array includes risk', () => {
    const findings = analyzeAlgorithmFindings(
      [
        'const lookup = new Set(ids);',
        'for (const id of otherIds) {',
        '  if (lookup.has(id)) {',
        '    doWork(id);',
        '  }',
        '}',
      ].join('\n'),
      'C:\\repo\\src\\set.ts',
      'C:\\repo',
    );

    assert.equal(findings.some(finding => finding.patternId === 'array_includes_in_loop'), false);
  });

  it('renders markdown with PR-ready recommendations', () => {
    const markdown = renderAlgorithmReviewMarkdown({
      generatedAt: '2026-07-26T00:00:00.000Z',
      rootDirectory: 'C:\\repo',
      targetPath: 'src',
      scannedFileCount: 3,
      findings: [{
        id: 'APR-1',
        patternId: 'array_find_in_loop',
        severity: 'high',
        filePath: 'src/orchestration/adapter.ts',
        line: 42,
        summary: 'Repeated linear search occurs inside a loop.',
        complexityBefore: 'O(n*m)',
        complexityAfter: 'O(n+m)',
        recommendationTitle: 'Index lookup targets once and replace repeated .find()',
        recommendation: 'Build a Map keyed by the lookup field before the loop.',
        prReadySketch: 'const byId = new Map(items.map(item => [item.id, item]));',
      }],
    });

    assert.ok(markdown.includes('## Top recommendations'));
    assert.ok(markdown.includes('PR-ready refactor sketch'));
    assert.ok(markdown.includes('APR-1'));
  });
});
