/**
 * flake-store.ts
 * ──────────────
 * Cross-run test health history, and the quarantine decisions derived from it.
 *
 * A single run cannot tell you whether a test is flaky — only that it failed.
 * Flakiness is a property of a test's behaviour *over time*, so it needs history.
 * This module owns that history: `.automaqa/history.json` in the project root.
 *
 * Two independent flake signals are recorded:
 *
 *   1. INTRA-RUN  — Playwright retried the test and it then passed. Same code, same
 *                   commit, different outcome: that is flakiness by definition, and
 *                   it is the strongest signal available.
 *   2. INTER-RUN  — the test's pass rate across recent runs is neither ~100% nor ~0%.
 *                   A test that fails half the time is flaky; one that fails every
 *                   time is simply broken, and must NOT be quarantined.
 *
 * The distinction in (2) matters more than anything else here. Quarantining a
 * consistently-failing test hides a real bug — the exact opposite of the intent.
 *
 * No dependencies beyond the Node standard library.
 */

import * as fs from 'fs';
import * as path from 'path';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** How a test ended, normalised across Playwright's statuses. */
export type Outcome = 'passed' | 'failed' | 'skipped';

/** One recorded execution of one test. */
export interface RunEntry {
  /** ISO timestamp of the run. */
  at: string;
  outcome: Outcome;
  /** Milliseconds. */
  duration: number;
  /** Retries Playwright needed before this outcome. >0 with `passed` = intra-run flake. */
  retries: number;
  /** Optional commit/branch, when the CI environment exposes it. */
  ref?: string;
}

/** Accumulated history for one test. */
export interface TestHistory {
  /** Stable identity: "<relative spec file> :: <full test title>". */
  id: string;
  /** Most recent runs first. Capped at HISTORY_LIMIT. */
  runs: RunEntry[];
  /** Set when quarantined, so the reason survives across runs. */
  quarantine?: {
    since: string;
    reason: string;
    /** Pass rate at the moment of quarantine, for the report. */
    passRateAtQuarantine: number;
  };
}

export interface Store {
  version: 1;
  updatedAt: string;
  tests: Record<string, TestHistory>;
}

/** Verdict for a single test after a run. */
export interface Verdict {
  id: string;
  /** Runs considered (capped by the window). */
  samples: number;
  /** 0..1 over the window. */
  passRate: number;
  /** Playwright retried and then passed, in the run just completed. */
  flakedThisRun: boolean;
  /** Flaky over the window: mixed outcomes, not consistently failing. */
  flakyOverTime: boolean;
  /** Failed every run in the window with enough samples — broken, never quarantined. */
  consistentlyFailing: boolean;
  /** Currently quarantined. */
  quarantined: boolean;
  /** Human-readable justification for the verdict. */
  reason: string;
}

export interface Thresholds {
  /** Runs to consider. Older runs are kept but not scored. */
  window: number;
  /** Minimum runs before pass rate is trusted enough to quarantine. */
  minSamples: number;
  /** Below this pass rate (and above `brokenBelow`) a test is quarantine-eligible. */
  quarantineBelow: number;
  /** At or below this pass rate the test is broken, not flaky — never quarantined. */
  brokenAtOrBelow: number;
  /** At or above this pass rate a quarantined test is released. */
  releaseAtOrAbove: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  window: 20,
  minSamples: 5,
  quarantineBelow: 0.8,
  brokenAtOrBelow: 0.05,
  releaseAtOrAbove: 0.95,
};

const HISTORY_LIMIT = 100;
const STORE_VERSION = 1 as const;

// ─────────────────────────────────────────────────────────────────────────────
// Identity
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a stable test id. Titles alone collide across files; file paths alone
 * collide across tests in a file. Paths are normalised to forward slashes and made
 * relative so ids match between a developer's Windows machine and Linux CI.
 */
export function testId(specFile: string, titlePath: string[]): string {
  const rel = path
    .relative(process.cwd(), specFile)
    .split(path.sep)
    .join('/');
  const file = rel && !rel.startsWith('..') ? rel : specFile.split(/[\\/]/).pop() ?? specFile;
  return `${file} :: ${titlePath.filter(Boolean).join(' > ')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

export function defaultStorePath(root = process.cwd()): string {
  return path.join(root, '.automaqa', 'history.json');
}

function emptyStore(): Store {
  return { version: STORE_VERSION, updatedAt: new Date().toISOString(), tests: {} };
}

/**
 * Load the store. A missing file is normal on a first run. A corrupt or
 * wrong-version file is discarded rather than throwing: losing history is
 * recoverable, blocking every test run is not.
 */
export function loadStore(storePath = defaultStorePath()): Store {
  let raw: string;
  try {
    raw = fs.readFileSync(storePath, 'utf8');
  } catch {
    return emptyStore();
  }

  try {
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (parsed?.version !== STORE_VERSION || !parsed.tests || typeof parsed.tests !== 'object') {
      return emptyStore();
    }
    return { version: STORE_VERSION, updatedAt: parsed.updatedAt ?? '', tests: parsed.tests };
  } catch {
    return emptyStore();
  }
}

/** Persist the store, creating `.automaqa/` if needed. Never throws. */
export function saveStore(store: Store, storePath = defaultStorePath()): boolean {
  try {
    fs.mkdirSync(path.dirname(storePath), { recursive: true });
    store.updatedAt = new Date().toISOString();
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
    return true;
  } catch (err) {
    process.stderr.write(
      `  [flake-store] could not write ${storePath}: ${(err as Error).message}\n`,
    );
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Recording
// ─────────────────────────────────────────────────────────────────────────────

/** Append one execution to a test's history, newest first, capped. */
export function record(store: Store, id: string, entry: RunEntry): TestHistory {
  const existing = store.tests[id] ?? { id, runs: [] };
  existing.runs.unshift(entry);
  if (existing.runs.length > HISTORY_LIMIT) existing.runs.length = HISTORY_LIMIT;
  store.tests[id] = existing;
  return existing;
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring
// ─────────────────────────────────────────────────────────────────────────────

/** Skipped runs carry no signal about correctness, so they are excluded. */
function scored(runs: RunEntry[], window: number): RunEntry[] {
  return runs.filter(r => r.outcome !== 'skipped').slice(0, window);
}

export function passRate(runs: RunEntry[], window = DEFAULT_THRESHOLDS.window): number {
  const rel = scored(runs, window);
  if (!rel.length) return 1;
  return rel.filter(r => r.outcome === 'passed').length / rel.length;
}

/**
 * Classify a test from its history.
 *
 * `consistentlyFailing` deliberately takes precedence over `flakyOverTime`: a test
 * that always fails is a bug to fix, and quarantining it would hide that bug.
 */
export function classify(
  history: TestHistory,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): Verdict {
  const { window, minSamples, quarantineBelow, brokenAtOrBelow } = thresholds;
  const rel = scored(history.runs, window);
  const samples = rel.length;
  const rate = passRate(history.runs, window);

  const latest = rel[0];
  const flakedThisRun = Boolean(latest && latest.outcome === 'passed' && latest.retries > 0);

  const enough = samples >= minSamples;
  const consistentlyFailing = enough && rate <= brokenAtOrBelow;
  const mixed = rate < quarantineBelow && rate > brokenAtOrBelow;
  const flakyOverTime = enough && mixed;

  let reason: string;
  if (consistentlyFailing) {
    reason = `failed ${rel.filter(r => r.outcome === 'failed').length}/${samples} runs — broken, not flaky`;
  } else if (flakyOverTime) {
    reason = `pass rate ${(rate * 100).toFixed(0)}% over ${samples} runs`;
  } else if (flakedThisRun) {
    reason = `passed only after ${latest!.retries} retry(ies) this run`;
  } else if (!enough) {
    reason = `only ${samples} scored run(s) — need ${minSamples} to judge`;
  } else {
    reason = `pass rate ${(rate * 100).toFixed(0)}% over ${samples} runs — healthy`;
  }

  return {
    id: history.id,
    samples,
    passRate: rate,
    flakedThisRun,
    flakyOverTime,
    consistentlyFailing,
    quarantined: Boolean(history.quarantine),
    reason,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Quarantine
// ─────────────────────────────────────────────────────────────────────────────

export interface QuarantineChange {
  id: string;
  action: 'quarantined' | 'released';
  reason: string;
  passRate: number;
}

/**
 * Apply quarantine policy across the store, mutating it, and return what changed.
 *
 * Quarantine is for tests that are *unreliable*, never for tests that are *failing*.
 * A consistently-failing test is left alone so it keeps breaking the build.
 */
export function applyQuarantinePolicy(
  store: Store,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): QuarantineChange[] {
  const changes: QuarantineChange[] = [];

  for (const history of Object.values(store.tests)) {
    const verdict = classify(history, thresholds);

    // Release: a quarantined test that has become reliable again.
    if (history.quarantine) {
      if (verdict.samples >= thresholds.minSamples && verdict.passRate >= thresholds.releaseAtOrAbove) {
        delete history.quarantine;
        changes.push({
          id: history.id,
          action: 'released',
          reason: `pass rate recovered to ${(verdict.passRate * 100).toFixed(0)}%`,
          passRate: verdict.passRate,
        });
      }
      continue;
    }

    // Never quarantine a consistently-failing test — that would hide a real bug.
    if (verdict.consistentlyFailing) continue;

    if (verdict.flakyOverTime) {
      history.quarantine = {
        since: new Date().toISOString(),
        reason: verdict.reason,
        passRateAtQuarantine: verdict.passRate,
      };
      changes.push({
        id: history.id,
        action: 'quarantined',
        reason: verdict.reason,
        passRate: verdict.passRate,
      });
    }
  }

  return changes;
}

/** Ids currently quarantined. */
export function quarantinedIds(store: Store): string[] {
  return Object.values(store.tests)
    .filter(t => t.quarantine)
    .map(t => t.id)
    .sort();
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite-level summary
// ─────────────────────────────────────────────────────────────────────────────

export interface HealthSummary {
  totalTracked: number;
  /** Tests that needed a retry in the run just completed. */
  flakedThisRun: Verdict[];
  /** Unreliable over the window. */
  flakyOverTime: Verdict[];
  /** Always failing — real bugs, listed so they are not mistaken for flakes. */
  consistentlyFailing: Verdict[];
  quarantined: Verdict[];
  /** Suite-wide flake rate: flaky tests / tests with enough samples. */
  flakeRate: number;
}

export function summarise(
  store: Store,
  thresholds: Thresholds = DEFAULT_THRESHOLDS,
): HealthSummary {
  const verdicts = Object.values(store.tests).map(t => classify(t, thresholds));
  const judgeable = verdicts.filter(v => v.samples >= thresholds.minSamples);
  const flakyOverTime = verdicts.filter(v => v.flakyOverTime);

  return {
    totalTracked: verdicts.length,
    flakedThisRun: verdicts.filter(v => v.flakedThisRun),
    flakyOverTime,
    consistentlyFailing: verdicts.filter(v => v.consistentlyFailing),
    quarantined: verdicts.filter(v => v.quarantined),
    flakeRate: judgeable.length ? flakyOverTime.length / judgeable.length : 0,
  };
}

/** Plain-text summary for CI logs. Empty string when there is nothing to report. */
export function formatHealthSummary(summary: HealthSummary): string {
  const { flakedThisRun, flakyOverTime, consistentlyFailing, quarantined } = summary;
  if (!flakedThisRun.length && !flakyOverTime.length && !consistentlyFailing.length && !quarantined.length) {
    return '';
  }

  const lines: string[] = ['', 'Test health', '─'.repeat(60)];
  lines.push(
    `tracked: ${summary.totalTracked}   flake rate: ${(summary.flakeRate * 100).toFixed(1)}%`,
  );

  const section = (title: string, verdicts: Verdict[]) => {
    if (!verdicts.length) return;
    lines.push('', title);
    for (const v of verdicts.slice(0, 10)) {
      lines.push(`  ${v.id}`);
      lines.push(`    ${v.reason}`);
    }
    if (verdicts.length > 10) lines.push(`  ... and ${verdicts.length - 10} more`);
  };

  section('Flaked in this run (passed only after a retry):', flakedThisRun);
  section('Unreliable over time:', flakyOverTime);
  section('Consistently failing — real bugs, NOT quarantined:', consistentlyFailing);
  section('Currently quarantined:', quarantined);

  return lines.join('\n');
}
