import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

describe('smoke', () => {
  it('passes', () => {
    assert.equal(1 + 1, 2);
  });
});
