import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isTransientError, retryTransient } from '../retry.js';

describe('retryTransient', () => {
  it('retries transient failures until the operation succeeds', async () => {
    let attempts = 0;
    const delays: number[] = [];

    const result = await retryTransient(async () => {
      attempts += 1;
      if (attempts < 3) {
        throw Object.assign(new Error('request failed'), { code: 'ETIMEDOUT' });
      }
      return 'ok';
    }, {
      sleep: async (ms) => {
        delays.push(ms);
      },
    });

    assert.equal(result, 'ok');
    assert.equal(attempts, 3);
    assert.deepEqual(delays, [250, 500]);
  });

  it('does not retry permanent failures', async () => {
    let attempts = 0;

    await assert.rejects(
      () => retryTransient(async () => {
        attempts += 1;
        throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      }, {
        sleep: async () => {},
      }),
      /permission denied/,
    );

    assert.equal(attempts, 1);
  });

  it('detects transient API errors', () => {
    assert.equal(isTransientError(Object.assign(new Error('gateway timeout'), { status: 502 })), true);
    assert.equal(isTransientError(Object.assign(new Error('permission denied'), { status: 403 })), false);
  });
});
