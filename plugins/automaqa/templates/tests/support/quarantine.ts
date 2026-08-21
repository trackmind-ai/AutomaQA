/**
 * quarantine.ts
 * ─────────────
 * Test fixture that skips quarantined tests, so a known-unreliable test stops
 * blocking the build without being deleted or silently forgotten.
 *
 * Quarantine is a holding pen with a visible exit, not a bin. A quarantined test:
 *   • still appears in the report, marked QUARANTINED with its pass rate
 *   • is still tracked, so it is released automatically once it becomes reliable
 *   • is counted in the flake rate, so the debt stays measurable
 *
 * Usage — replace the `test` import in your specs:
 *
 *   import { test, expect } from '../support/quarantine';
 *
 * Then run normally. To run ONLY the quarantined tests (to work on them):
 *
 *   AUTOMAQA_QUARANTINE=only npx playwright test
 *
 * To ignore quarantine entirely (to check whether they now pass):
 *
 *   AUTOMAQA_QUARANTINE=off npx playwright test
 *
 * See the `automaqa:flake-guard` skill for the policy behind this.
 */

import { test as base, expect } from '@playwright/test';
import { loadStore, quarantinedIds, testId } from './flake-store';

export { expect };

/** How quarantine behaves this run. */
export type QuarantineMode = 'on' | 'off' | 'only';

export function quarantineMode(): QuarantineMode {
  const raw = (process.env.AUTOMAQA_QUARANTINE ?? 'on').toLowerCase();
  return raw === 'off' || raw === 'only' ? raw : 'on';
}

// Loaded once per worker process rather than per test — the store does not change
// mid-run, and re-reading it for every test would be wasteful.
let cachedQuarantined: Set<string> | null = null;

function quarantinedSet(): Set<string> {
  if (!cachedQuarantined) {
    cachedQuarantined = new Set(quarantinedIds(loadStore()));
  }
  return cachedQuarantined;
}

/**
 * `test` with quarantine awareness. A quarantined test is skipped with a reason
 * naming its pass rate, so the report explains itself without a lookup.
 */
export const test = base.extend<Record<string, never>>({});

test.beforeEach(async ({}, testInfo) => {
  const mode = quarantineMode();
  if (mode === 'off') return;

  const id = testId(testInfo.file, testInfo.titlePath.slice(1));
  const isQuarantined = quarantinedSet().has(id);

  if (mode === 'only') {
    // Inverted run: work on the quarantined set in isolation.
    test.skip(!isQuarantined, 'not quarantined (AUTOMAQA_QUARANTINE=only)');
    return;
  }

  if (isQuarantined) {
    const history = loadStore().tests[id];
    const rate = history?.quarantine
      ? `${(history.quarantine.passRateAtQuarantine * 100).toFixed(0)}%`
      : 'unknown';
    const since = history?.quarantine?.since?.slice(0, 10) ?? 'unknown';
    test.skip(
      true,
      `QUARANTINED since ${since} — pass rate was ${rate}. ` +
      'Run with AUTOMAQA_QUARANTINE=off to include it.',
    );
  }
});
