/**
 * ui-time-info.test.ts — regression test for T-053: `renderTimeInfo`
 * (web/js/ui.js) must render on-screen text that reads the same as the
 * domain's own `combined_label`, separator included. `renderTotalActiveTime`
 * (domain/src/reasons.ts) is the single authority for this copy, so this
 * test imports it directly and compares the rendered DOM's `textContent`
 * against the domain's own output rather than against a hand-typed literal
 * — the only way to catch a client-side rounding or joining drift that a
 * hardcoded string would silently miss.
 *
 * `web/js/ui.js` is plain browser ESM that expects a global `document`.
 * There is no jsdom in this project (zero runtime dependencies), so this
 * file defines the minimal DOM shim `renderTimeInfo` actually exercises
 * (createElement / createTextNode / appendChild / className / setAttribute
 * / dataset / textContent) and installs it on `globalThis` before
 * dynamically importing `ui.js`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderTotalActiveTime } from '../domain/src/reasons.ts';

// ---------------------------------------------------------------------------
// Minimal DOM shim — just enough for `h()` and `renderTimeInfo` in ui.js.
// ---------------------------------------------------------------------------

class ShimText {
  data: string;
  constructor(data: string) {
    this.data = data;
  }
  get textContent(): string {
    return this.data;
  }
}

class ShimElement {
  className = '';
  dataset: Record<string, string> = {};
  private attrs = new Map<string, string>();
  private kids: Array<ShimText | ShimElement> = [];
  appendChild(child: ShimText | ShimElement): void {
    this.kids.push(child);
  }
  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }
  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }
  get textContent(): string {
    return this.kids.map((k) => k.textContent).join('');
  }
}

const shimDocument = {
  createElement: (): ShimElement => new ShimElement(),
  createTextNode: (data: string): ShimText => new ShimText(data),
};

(globalThis as unknown as { document: typeof shimDocument }).document = shimDocument;

// `web/js/ui.js` is plain browser JS with no declaration file (this project
// is deliberately dependency-free, so `allowJs`/`checkJs` are off for the
// TS-strict `domain`/`server`/`tests` trees) — bridge to it as `unknown`
// and narrow explicitly rather than letting it flow in as `any`.
// @ts-expect-error -- no declaration file for this plain-JS module by design
const uiModule: unknown = await import('../web/js/ui.js');
type RenderTimeInfoFields = { total_seconds?: number; active_seconds?: number; time_label?: string };
const { renderTimeInfo } = uiModule as { renderTimeInfo: (fields?: RenderTimeInfoFields) => ShimElement };

// ---------------------------------------------------------------------------
// Both fields present — the reported bug: text must not run the two
// halves together with no separator ("26 min total16 min hands-on").
// ---------------------------------------------------------------------------

test('renderTimeInfo: both fields present reads the same as the domain combined_label', () => {
  const domain = renderTotalActiveTime(1560, 960); // 26 min total, 16 min hands-on
  const el = renderTimeInfo({ total_seconds: 1560, active_seconds: 960 });
  assert.equal(el.textContent, domain.combined_label);
  assert.equal(el.getAttribute('aria-label'), domain.combined_label);
});

test('renderTimeInfo: sub-minute (under 1 min) durations on both sides match the domain', () => {
  const domain = renderTotalActiveTime(10, 5); // rounds to 0 minutes each side
  const el = renderTimeInfo({ total_seconds: 10, active_seconds: 5 });
  assert.equal(domain.combined_label, 'under 1 min total, under 1 min hands-on');
  assert.equal(el.textContent, domain.combined_label);
  assert.equal(el.getAttribute('aria-label'), domain.combined_label);
});

test('renderTimeInfo: total-only matches the domain total_label, no stray separator', () => {
  const domain = renderTotalActiveTime(1560, 0);
  const el = renderTimeInfo({ total_seconds: 1560 });
  assert.equal(el.textContent, domain.total_label);
  assert.ok(!el.textContent.includes(','));
});

test('renderTimeInfo: active-only matches the domain active_label, no stray separator', () => {
  const domain = renderTotalActiveTime(960, 960);
  const el = renderTimeInfo({ active_seconds: 960 });
  assert.equal(el.textContent, domain.active_label);
  assert.ok(!el.textContent.includes(','));
});

test('renderTimeInfo: neither field present falls back to the provided label or the fixed fallback text', () => {
  const withLabel = renderTimeInfo({ time_label: 'Ready in a snap' });
  assert.equal(withLabel.textContent, 'Ready in a snap');

  const withoutLabel = renderTimeInfo({});
  assert.equal(withoutLabel.textContent, 'Time not available');
});
