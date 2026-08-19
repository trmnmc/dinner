/**
 * ui-duration-words.test.ts — regression test for T-067: the prep screen's
 * "Pause up to 418 minutes" bug. `durationWords` (web/js/ui.js) is the one
 * shared place that turns a raw seconds count into humane, spoken-register
 * copy — this test locks in the formatting ladder (seconds / minutes /
 * about-N-hours / hours-and-minutes) at exact-string granularity so a
 * future edit can't quietly reintroduce a raw "418 minutes" or a malformed
 * "1 hours".
 *
 * `web/js/ui.js` is plain browser ESM with no declaration file (this
 * project is deliberately dependency-free, so `allowJs`/`checkJs` are off
 * for the TS-strict `domain`/`server`/`tests` trees) — same dynamic-import
 * bridge pattern as `tests/ui-time-info.test.ts` uses for the same module.
 * `durationWords` itself never touches `document`, so unlike that sibling
 * test this file needs no DOM shim.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

// @ts-expect-error -- no declaration file for this plain-JS module by design
const uiModule: unknown = await import('../web/js/ui.js');
const { durationWords } = uiModule as { durationWords: (seconds: number) => string };

// ---------------------------------------------------------------------------
// Sub-minute — several authored `maximum_pause` windows are genuinely under
// a minute; these must stay in exact, countable seconds, never round away
// to "under 1 minute".
// ---------------------------------------------------------------------------

test('durationWords: sub-minute durations stay in exact seconds', () => {
  assert.equal(durationWords(20), '20 seconds');
  assert.equal(durationWords(1), '1 second');
  assert.equal(durationWords(0), '0 seconds');
});

// ---------------------------------------------------------------------------
// Minute-scale — under an hour stays in minutes.
// ---------------------------------------------------------------------------

test('durationWords: minute-scale durations round to whole minutes', () => {
  assert.equal(durationWords(60), '1 minute');
  assert.equal(durationWords(90), '2 minutes'); // rounds up, not "1.5 minutes"
  assert.equal(durationWords(300), '5 minutes');
  assert.equal(durationWords(3599), 'about 1 hour'); // rounds up to 60 min, which promotes to hours rather than showing "60 minutes"
});

// ---------------------------------------------------------------------------
// The reported bug: 418 minutes must never appear on screen.
// ---------------------------------------------------------------------------

test('durationWords: the reported 418-minute bug now reads as "about 7 hours"', () => {
  const seconds = 418 * 60; // 25080s = 6h58m, the exact bug report shape
  assert.equal(durationWords(seconds), 'about 7 hours');
  assert.ok(!durationWords(seconds).includes('418'));
  assert.ok(!durationWords(seconds).includes('minutes'));
});

// ---------------------------------------------------------------------------
// Hour-scale edge cases — must never produce a malformed "1 hours".
// ---------------------------------------------------------------------------

test('durationWords: exactly one hour reads "about 1 hour", never "1 hours"', () => {
  assert.equal(durationWords(3600), 'about 1 hour');
});

test('durationWords: near-hour-boundary durations round cleanly to whole hours', () => {
  assert.equal(durationWords(3600 * 2 + 60 * 5), 'about 2 hours'); // 2h5m -> about 2 hours
  assert.equal(durationWords(3600 * 6 + 60 * 55), 'about 7 hours'); // 6h55m -> about 7 hours
});

test('durationWords: mid-hour durations spell out hours and minutes', () => {
  assert.equal(durationWords(3600 + 60 * 30), '1 hour 30 minutes');
  assert.equal(durationWords(3600 * 3 + 60 * 20), '3 hours 20 minutes');
});
