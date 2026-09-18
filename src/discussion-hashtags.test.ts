import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ALLOWED_DISCUSSION_HASHTAGS,
  DEFAULT_DISCUSSION_HASHTAGS,
  DEFAULT_DISCUSSION_HASHTAGS_CSV,
} from './discussion-hashtags.js';

test('default discussion hashtags are an ordered subset of allowed hashtags', () => {
  assert.ok(DEFAULT_DISCUSSION_HASHTAGS.length > 0);

  for (const hashtag of DEFAULT_DISCUSSION_HASHTAGS) {
    assert.ok(ALLOWED_DISCUSSION_HASHTAGS.includes(hashtag));
  }
});

test('discussion hashtag collections contain no duplicates', () => {
  assert.equal(
    new Set(ALLOWED_DISCUSSION_HASHTAGS).size,
    ALLOWED_DISCUSSION_HASHTAGS.length,
  );
  assert.equal(
    new Set(DEFAULT_DISCUSSION_HASHTAGS).size,
    DEFAULT_DISCUSSION_HASHTAGS.length,
  );
});

test('discussion hashtags use hashtag syntax', () => {
  for (const hashtag of ALLOWED_DISCUSSION_HASHTAGS) {
    assert.match(hashtag, /^#[A-Za-z0-9]+$/);
  }
});

test('default discussion hashtag CSV is derived from the default list', () => {
  assert.equal(
    DEFAULT_DISCUSSION_HASHTAGS_CSV,
    DEFAULT_DISCUSSION_HASHTAGS.join(','),
  );
});
