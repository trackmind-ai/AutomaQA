/**
 * Tests for the flake-detection engine.
 *
 * Run: npx playwright test --config tests/healing/playwright.config.ts
 * (uses Playwright purely as the test runner — no browser is launched here)
 *
 * The most important assertions in this file are the ones proving a
 * consistently-failing test is NEVER quarantined. Quarantining a broken test hides
 * a real bug, which is the exact opposite of what quarantine is for.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  type Store,
  type RunEntry,
  type Thresholds,
  DEFAULT_THRESHOLDS,
  testId,
  loadStore,
  saveStore,
  record,
  passRate,
  classify,
  applyQuarantinePolicy,
  quarantinedIds,
  summarise,
  formatHealthSummary,
} from '../plugins/automaqa/templates/tests/support/flake-store';

// ── helpers ─────────────────────────────────────────────────────────────────

function entry(outcome: RunEntry['outcome'], retries = 0): RunEntry {
  return { at: new Date().toISOString(), outcome, duration: 100, retries };
}

/** Build a store where `id` has the given outcomes, newest first. */
function storeWith(id: string, outcomes: Array<RunEntry['outcome']>, retries = 0): Store {
  const store: Store = { version: 1, updatedAt: '', tests: {} };
  // record() unshifts, so append in reverse to get the requested order.
  for (const o of [...outcomes].reverse()) record(store, id, entry(o, retries));
  return store;
}

const T: Thresholds = DEFAULT_THRESHOLDS;
const P = 'passed' as const;
const F = 'failed' as const;
const S = 'skipped' as const;

// ── identity ────────────────────────────────────────────────────────────────

test.describe('testId', () => {
  test('combines file and full title path', () => {
    const id = testId(path.join(process.cwd(), 'tests', 'e2e', 'login.spec.ts'), ['Login', 'valid creds']);
    expect(id).toBe('tests/e2e/login.spec.ts :: Login > valid creds');
  });

  test('uses forward slashes so ids match across Windows and Linux', () => {
    const id = testId(path.join(process.cwd(), 'a', 'b', 'c.spec.ts'), ['t']);
    expect(id).not.toContain('\\');
    expect(id).toContain('a/b/c.spec.ts');
  });

  test('distinguishes identical titles in different files', () => {
    const a = testId(path.join(process.cwd(), 'x.spec.ts'), ['same title']);
    const b = testId(path.join(process.cwd(), 'y.spec.ts'), ['same title']);
    expect(a).not.toBe(b);
  });

  test('drops empty title segments', () => {
    const id = testId(path.join(process.cwd(), 'x.spec.ts'), ['', 'Suite', '', 'case']);
    expect(id).toBe('x.spec.ts :: Suite > case');
  });
});

// ── pass rate ───────────────────────────────────────────────────────────────

test.describe('passRate', () => {
  test('is 1 with no history', () => {
    expect(passRate([])).toBe(1);
  });

  test('counts passes over scored runs', () => {
    const runs = [entry(P), entry(F), entry(P), entry(P)];
    expect(passRate(runs)).toBeCloseTo(0.75);
  });

  test('excludes skipped runs, which carry no correctness signal', () => {
    // 2 passed, 1 failed, 5 skipped -> 2/3, not 2/8
    const runs = [entry(P), entry(S), entry(F), entry(S), entry(P), entry(S), entry(S), entry(S)];
    expect(passRate(runs)).toBeCloseTo(2 / 3);
  });

  test('only considers the window', () => {
    // 3 recent passes then 20 old failures; window of 3 sees only the passes.
    const runs = [entry(P), entry(P), entry(P), ...Array(20).fill(null).map(() => entry(F))];
    expect(passRate(runs, 3)).toBe(1);
  });
});

// ── classification ──────────────────────────────────────────────────────────

test.describe('classify', () => {
  test('a healthy test is neither flaky nor failing', () => {
    const v = classify(storeWith('t', [P, P, P, P, P, P]).tests['t']);
    expect(v.flakyOverTime).toBe(false);
    expect(v.consistentlyFailing).toBe(false);
    expect(v.passRate).toBe(1);
    expect(v.reason).toContain('healthy');
  });

  test('mixed outcomes over the window are flaky', () => {
    const v = classify(storeWith('t', [P, F, P, F, P, F]).tests['t']);
    expect(v.flakyOverTime).toBe(true);
    expect(v.consistentlyFailing).toBe(false);
    expect(v.passRate).toBeCloseTo(0.5);
  });

  test('always failing is BROKEN, never flaky', () => {
    const v = classify(storeWith('t', [F, F, F, F, F, F]).tests['t']);
    expect(v.consistentlyFailing).toBe(true);
    expect(v.flakyOverTime).toBe(false);
    expect(v.reason).toContain('broken, not flaky');
  });

  test('a retry-then-pass in the latest run is an intra-run flake', () => {
    const store: Store = { version: 1, updatedAt: '', tests: {} };
    record(store, 't', entry(P, 2));
    const v = classify(store.tests['t']);
    expect(v.flakedThisRun).toBe(true);
    expect(v.reason).toContain('retry');
  });

  test('a first-attempt pass is not an intra-run flake', () => {
    const store: Store = { version: 1, updatedAt: '', tests: {} };
    record(store, 't', entry(P, 0));
    expect(classify(store.tests['t']).flakedThisRun).toBe(false);
  });

  test('too few samples means no verdict yet', () => {
    const v = classify(storeWith('t', [P, F]).tests['t']);
    expect(v.samples).toBe(2);
    expect(v.flakyOverTime).toBe(false);
    expect(v.consistentlyFailing).toBe(false);
    expect(v.reason).toContain(`need ${T.minSamples}`);
  });

  test('a test just above the quarantine threshold stays healthy', () => {
    // 19/20 = 95%, above quarantineBelow (80%)
    const outcomes = [...Array(19).fill(P), F] as Array<RunEntry['outcome']>;
    const v = classify(storeWith('t', outcomes).tests['t']);
    expect(v.passRate).toBeCloseTo(0.95);
    expect(v.flakyOverTime).toBe(false);
  });

  test('a test just below the quarantine threshold is flaky', () => {
    // 3/4 = 75%, below 80%, with enough samples via a 5th run
    const outcomes = [P, P, P, F, F] as Array<RunEntry['outcome']>;
    const v = classify(storeWith('t', outcomes).tests['t']);
    expect(v.passRate).toBeCloseTo(0.6);
    expect(v.flakyOverTime).toBe(true);
  });
});

// ── quarantine policy ───────────────────────────────────────────────────────

test.describe('applyQuarantinePolicy', () => {
  test('quarantines an unreliable test', () => {
    const store = storeWith('flaky', [P, F, P, F, P, F]);
    const changes = applyQuarantinePolicy(store);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: 'flaky', action: 'quarantined' });
    expect(store.tests['flaky'].quarantine).toBeTruthy();
    expect(quarantinedIds(store)).toEqual(['flaky']);
  });

  test('NEVER quarantines a consistently-failing test — that would hide a real bug', () => {
    const store = storeWith('broken', [F, F, F, F, F, F, F, F]);
    const changes = applyQuarantinePolicy(store);
    expect(changes).toHaveLength(0);
    expect(store.tests['broken'].quarantine).toBeUndefined();
    expect(quarantinedIds(store)).toEqual([]);
  });

  test('does not quarantine a healthy test', () => {
    const store = storeWith('good', [P, P, P, P, P, P]);
    expect(applyQuarantinePolicy(store)).toHaveLength(0);
    expect(store.tests['good'].quarantine).toBeUndefined();
  });

  test('does not quarantine before minSamples runs', () => {
    const store = storeWith('new', [P, F]);
    expect(applyQuarantinePolicy(store)).toHaveLength(0);
    expect(store.tests['new'].quarantine).toBeUndefined();
  });

  test('releases a quarantined test that has recovered', () => {
    const store = storeWith('recovered', [P, P, P, P, P, P]);
    store.tests['recovered'].quarantine = {
      since: new Date().toISOString(),
      reason: 'was flaky',
      passRateAtQuarantine: 0.5,
    };
    const changes = applyQuarantinePolicy(store);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ id: 'recovered', action: 'released' });
    expect(store.tests['recovered'].quarantine).toBeUndefined();
  });

  test('keeps a still-flaky test quarantined without re-reporting it', () => {
    const store = storeWith('still', [P, F, P, F, P, F]);
    store.tests['still'].quarantine = {
      since: new Date().toISOString(),
      reason: 'flaky',
      passRateAtQuarantine: 0.5,
    };
    expect(applyQuarantinePolicy(store)).toHaveLength(0);
    expect(store.tests['still'].quarantine).toBeTruthy();
  });

  test('records the pass rate at quarantine time', () => {
    const store = storeWith('f', [P, F, F, F, P, F]);
    applyQuarantinePolicy(store);
    const q = store.tests['f'].quarantine!;
    expect(q.passRateAtQuarantine).toBeCloseTo(1 / 3);
    expect(q.since).toBeTruthy();
  });

  test('is idempotent across repeated runs', () => {
    const store = storeWith('f', [P, F, P, F, P, F]);
    expect(applyQuarantinePolicy(store)).toHaveLength(1);
    expect(applyQuarantinePolicy(store)).toHaveLength(0);
    expect(applyQuarantinePolicy(store)).toHaveLength(0);
  });
});

// ── persistence ─────────────────────────────────────────────────────────────

test.describe('persistence', () => {
  let dir: string;
  let file: string;

  test.beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'automaqa-flake-'));
    file = path.join(dir, '.automaqa', 'history.json');
  });

  test.afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('a missing store loads as empty, not an error', () => {
    const store = loadStore(path.join(dir, 'nope.json'));
    expect(store.version).toBe(1);
    expect(Object.keys(store.tests)).toHaveLength(0);
  });

  test('round-trips through disk, creating the directory', () => {
    const store = storeWith('t', [P, F, P]);
    expect(saveStore(store, file)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);

    const reloaded = loadStore(file);
    expect(reloaded.tests['t'].runs).toHaveLength(3);
    expect(reloaded.tests['t'].runs[0].outcome).toBe(P);
  });

  test('a corrupt store is discarded rather than throwing', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{ this is not json');
    const store = loadStore(file);
    expect(Object.keys(store.tests)).toHaveLength(0);
  });

  test('a store from a future version is discarded', () => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 99, tests: { a: { id: 'a', runs: [] } } }));
    expect(Object.keys(loadStore(file).tests)).toHaveLength(0);
  });

  test('quarantine state survives a round trip', () => {
    const store = storeWith('f', [P, F, P, F, P, F]);
    applyQuarantinePolicy(store);
    saveStore(store, file);
    expect(loadStore(file).tests['f'].quarantine).toBeTruthy();
  });
});

// ── history growth ──────────────────────────────────────────────────────────

test.describe('record', () => {
  test('newest run is first', () => {
    const store: Store = { version: 1, updatedAt: '', tests: {} };
    record(store, 't', entry(P));
    record(store, 't', entry(F));
    expect(store.tests['t'].runs[0].outcome).toBe(F);
  });

  test('history is capped so the file cannot grow without bound', () => {
    const store: Store = { version: 1, updatedAt: '', tests: {} };
    for (let i = 0; i < 250; i++) record(store, 't', entry(P));
    expect(store.tests['t'].runs.length).toBeLessThanOrEqual(100);
  });
});

// ── summary ─────────────────────────────────────────────────────────────────

test.describe('summarise', () => {
  test('separates flaky from broken', () => {
    const store: Store = { version: 1, updatedAt: '', tests: {} };
    for (const o of [P, F, P, F, P, F].reverse()) record(store, 'flaky', entry(o));
    for (const o of [F, F, F, F, F, F]) record(store, 'broken', entry(o));
    for (const o of [P, P, P, P, P, P]) record(store, 'good', entry(o));

    const s = summarise(store);
    expect(s.totalTracked).toBe(3);
    expect(s.flakyOverTime.map(v => v.id)).toEqual(['flaky']);
    expect(s.consistentlyFailing.map(v => v.id)).toEqual(['broken']);
  });

  test('flake rate is flaky over judgeable tests', () => {
    const store: Store = { version: 1, updatedAt: '', tests: {} };
    for (const o of [P, F, P, F, P, F]) record(store, 'flaky', entry(o));
    for (const o of [P, P, P, P, P, P]) record(store, 'good', entry(o));
    expect(summarise(store).flakeRate).toBeCloseTo(0.5);
  });

  test('flake rate is 0 when nothing has enough samples', () => {
    const store = storeWith('t', [P, F]);
    expect(summarise(store).flakeRate).toBe(0);
  });

  test('a healthy suite produces no summary text', () => {
    const store = storeWith('good', [P, P, P, P, P, P]);
    expect(formatHealthSummary(summarise(store))).toBe('');
  });

  test('summary text names broken tests as not quarantined', () => {
    const store = storeWith('broken', [F, F, F, F, F, F]);
    const text = formatHealthSummary(summarise(store));
    expect(text).toContain('broken');
    expect(text).toContain('NOT quarantined');
  });
});
