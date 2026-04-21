/**
 * Tests for the schedule module and parseScheduleTag function.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseScheduleTag, parseFrontmatter } from '../src/parser.js';

// ---------------------------------------------------------------------------
// parseScheduleTag tests
// ---------------------------------------------------------------------------

describe('parseScheduleTag', () => {
  it('extracts a valid ISO 8601 time from a heading', () => {
    const result = parseScheduleTag('My Post {time: 2026-04-22T10:00Z}');
    assert.equal(result.cleanHeading, 'My Post');
    assert.ok(result.scheduledTime instanceof Date);
    assert.equal(result.scheduledTime.toISOString(), '2026-04-22T10:00:00.000Z');
  });

  it('handles a heading with no schedule tag', () => {
    const result = parseScheduleTag('Regular post title');
    assert.equal(result.cleanHeading, 'Regular post title');
    assert.equal(result.scheduledTime, null);
  });

  it('handles an empty heading', () => {
    const result = parseScheduleTag('');
    assert.equal(result.cleanHeading, '');
    assert.equal(result.scheduledTime, null);
  });

  it('strips the tag from the middle of a heading', () => {
    const result = parseScheduleTag('Before {time: 2026-01-01T00:00Z} After');
    assert.equal(result.cleanHeading, 'Before After');
    assert.equal(result.scheduledTime.toISOString(), '2026-01-01T00:00:00.000Z');
  });

  it('handles timezone offsets', () => {
    const result = parseScheduleTag('Post {time: 2026-06-15T14:30+02:00}');
    assert.equal(result.cleanHeading, 'Post');
    assert.ok(result.scheduledTime instanceof Date);
    // 14:30+02:00 = 12:30 UTC
    assert.equal(result.scheduledTime.toISOString(), '2026-06-15T12:30:00.000Z');
  });

  it('handles date-only format', () => {
    const result = parseScheduleTag('Post {time: 2026-06-15}');
    assert.equal(result.cleanHeading, 'Post');
    assert.ok(result.scheduledTime instanceof Date);
    assert.ok(!isNaN(result.scheduledTime.getTime()));
  });

  it('returns null scheduledTime for invalid dates', () => {
    const result = parseScheduleTag('Post {time: not-a-date}');
    // Invalid date should return the heading unchanged and scheduledTime null
    assert.equal(result.cleanHeading, 'Post {time: not-a-date}');
    assert.equal(result.scheduledTime, null);
  });

  it('handles extra whitespace in the tag', () => {
    const result = parseScheduleTag('Post {time:   2026-04-22T10:00Z  }');
    assert.equal(result.cleanHeading, 'Post');
    assert.equal(result.scheduledTime.toISOString(), '2026-04-22T10:00:00.000Z');
  });
});

// ---------------------------------------------------------------------------
// Frontmatter post_on tests
// ---------------------------------------------------------------------------

describe('parseFrontmatter post_on key', () => {
  it('defaults post_on to "push_or_schedule" when not specified', () => {
    const result = parseFrontmatter('---\nyodelog: true\n---\n');
    assert.equal(result.post_on, 'push_or_schedule');
  });

  it('parses post_on: push', () => {
    const result = parseFrontmatter('---\nyodelog: true\npost_on: push\n---\n');
    assert.equal(result.post_on, 'push');
  });

  it('parses post_on: schedule', () => {
    const result = parseFrontmatter('---\nyodelog: true\npost_on: schedule\n---\n');
    assert.equal(result.post_on, 'schedule');
  });

  it('parses post_on: push_or_schedule', () => {
    const result = parseFrontmatter('---\nyodelog: true\npost_on: push_or_schedule\n---\n');
    assert.equal(result.post_on, 'push_or_schedule');
  });

  it('falls back to "push_or_schedule" for invalid post_on values', () => {
    const result = parseFrontmatter('---\nyodelog: true\npost_on: invalid\n---\n');
    assert.equal(result.post_on, 'push_or_schedule');
  });

  it('handles quoted post_on values', () => {
    const result = parseFrontmatter('---\nyodelog: true\npost_on: "schedule"\n---\n');
    assert.equal(result.post_on, 'schedule');
  });
});

// ---------------------------------------------------------------------------
// Schedule window logic tests (unit-level, no git)
// ---------------------------------------------------------------------------

describe('schedule window logic', () => {
  it('correctly identifies posts within the time window', () => {
    // Simulate the window check: watermark < scheduledTime <= now
    const watermark = new Date('2026-04-20T00:00Z');
    const now = new Date('2026-04-22T12:00Z');

    const testCases = [
      // { scheduledTime, expected: true if should be broadcast }
      { time: '2026-04-21T10:00Z', expected: true },   // within window
      { time: '2026-04-22T12:00Z', expected: true },   // exactly now (inclusive)
      { time: '2026-04-20T00:00Z', expected: false },  // exactly watermark (exclusive)
      { time: '2026-04-19T23:59Z', expected: false },  // before watermark
      { time: '2026-04-22T12:01Z', expected: false },  // after now
      { time: '2026-04-25T00:00Z', expected: false },  // far future
    ];

    for (const tc of testCases) {
      const scheduled = new Date(tc.time);
      const inWindow = scheduled > watermark && scheduled <= now;
      assert.equal(inWindow, tc.expected,
        `${tc.time} should ${tc.expected ? '' : 'NOT '}be in window`);
    }
  });
});
