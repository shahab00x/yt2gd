/**
 * Unit tests for the adjustable per-watcher upload quota
 * (`dailyLimit` uploads per `limitWindowHours` hours).
 * Pure-function tests only — no watcher-store disk I/O.
 * Run: node --test server/services/bastyon/watchers-quota.test.js
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  WATCHER_DEFAULTS,
  WATCHER_LIMITS,
  WatcherValidationError,
  validateWatcherInput,
  quotaWindowMs,
  uploadsInWindow,
  remainingQuota,
  toSummary,
} from './watchers.js';

const HOUR = 60 * 60 * 1000;

// --- Validation ---

test('limitWindowHours defaults: full create passes without it', () => {
  const clean = validateWatcherInput({
    type: 'playlist',
    name: 'w',
    sourceUrl: 'https://www.youtube.com/playlist?list=PL123',
    accountId: 'a1',
  });
  assert.equal(clean.limitWindowHours, undefined);
  assert.equal(WATCHER_DEFAULTS.limitWindowHours, 24);
});

test('limitWindowHours accepts 1..168, rejects the rest', () => {
  for (const ok of [1, 8, 12, 24, 168, '12']) {
    const clean = validateWatcherInput({ limitWindowHours: ok }, { partial: true });
    assert.equal(clean.limitWindowHours, Number(ok));
  }
  for (const bad of [0, -1, 169, 1000, 1.5, 'soon', NaN, '']) {
    assert.throws(
      () => validateWatcherInput({ limitWindowHours: bad }, { partial: true }),
      WatcherValidationError,
      `expected rejection for ${JSON.stringify(bad)}`,
    );
  }
});

test('window limits are 1h..168h', () => {
  assert.equal(WATCHER_LIMITS.windowMin, 1);
  assert.equal(WATCHER_LIMITS.windowMax, 168);
});

// --- Window math ---

test('quotaWindowMs honors the watcher window, defaults to 24h', () => {
  assert.equal(quotaWindowMs({ limitWindowHours: 12 }), 12 * HOUR);
  assert.equal(quotaWindowMs({ limitWindowHours: 1 }), 1 * HOUR);
  assert.equal(quotaWindowMs({ limitWindowHours: 168 }), 168 * HOUR);
  assert.equal(quotaWindowMs({}), 24 * HOUR);
  assert.equal(quotaWindowMs(null), 24 * HOUR);
});

test('quotaWindowMs clamps legacy/corrupt values defensively', () => {
  assert.equal(quotaWindowMs({ limitWindowHours: 0 }), 1 * HOUR);
  assert.equal(quotaWindowMs({ limitWindowHours: 9999 }), 168 * HOUR);
  assert.equal(quotaWindowMs({ limitWindowHours: 2.5 }), 24 * HOUR);
  assert.equal(quotaWindowMs({ limitWindowHours: 'soon' }), 24 * HOUR);
});

// --- Rolling quota ---

test('uploadsInWindow counts only entries inside the watcher window', () => {
  const now = Date.now();
  const w12 = { limitWindowHours: 12, uploadLog: [{ at: now - 11 * HOUR }, { at: now - 13 * HOUR }] };
  assert.equal(uploadsInWindow(w12), 1);
  const wDefault = { uploadLog: [{ at: now - 11 * HOUR }, { at: now - 13 * HOUR }] };
  assert.equal(uploadsInWindow(wDefault), 2); // 24h default covers both
  assert.equal(uploadsInWindow({ limitWindowHours: 12 }), 0);
  assert.equal(uploadsInWindow({}), 0);
});

test('1-per-12h steady state: blocked at +11h, free at +12h01', () => {
  const now = Date.now();
  const mk = (ageMs) => ({ limitWindowHours: 12, dailyLimit: 1, uploadLog: [{ at: now - ageMs }] });
  assert.equal(remainingQuota(mk(11 * HOUR)), 0);
  assert.equal(remainingQuota(mk(12 * HOUR + 60 * 1000)), 1);
  assert.equal(remainingQuota(mk(25 * HOUR)), 1);
});

test('remainingQuota respects limit and window together', () => {
  const now = Date.now();
  const w = {
    limitWindowHours: 8,
    dailyLimit: 2,
    uploadLog: [{ at: now - 1 * HOUR }, { at: now - 2 * HOUR }, { at: now - 9 * HOUR }],
  };
  assert.equal(uploadsInWindow(w), 2);
  assert.equal(remainingQuota(w), 0);
  const w2 = { ...w, uploadLog: [{ at: now - 1 * HOUR }, { at: now - 9 * HOUR }] };
  assert.equal(remainingQuota(w2), 1);
});

// --- Summary ---

test('toSummary exposes windowed usage and the window itself', () => {
  const now = Date.now();
  const s = toSummary({
    id: 'watch_x', type: 'playlist', name: 'w', sourceUrl: 'https://www.youtube.com/playlist?list=PL123',
    accountId: 'a1', format: 'video', quality: 'best', audioLanguage: 'original',
    checkIntervalMinutes: 15, dailyLimit: 1, limitWindowHours: 12, enabled: true,
    seeded: true, seenVideoIds: ['a', 'b'],
    uploadLog: [{ at: now - 1 * HOUR }],
    createdAt: now, updatedAt: now,
  });
  assert.equal(s.limitWindowHours, 12);
  assert.equal(s.uploadsInWindow, 1);
  assert.equal(s.uploadsToday, undefined);
});

test('toSummary defaults a missing window to 24h', () => {
  const s = toSummary({ id: 'watch_y', uploadLog: [] });
  assert.equal(s.limitWindowHours, 24);
  assert.equal(s.uploadsInWindow, 0);
});
