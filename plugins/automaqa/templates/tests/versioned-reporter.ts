/**
 * versioned-reporter.ts
 * ─────────────────────
 * Custom Playwright Reporter that writes a versioned HTML report after every run.
 *
 * Output path: specs/<feature-slug>/report-v{N}.html
 * N auto-increments by counting existing report-v*.html files in that directory.
 *
 * The slug is derived from the spec file name:
 *   tests/e2e/login-test-cases.spec.ts  →  specs/login-test-cases/report-v1.html
 *
 * Also owns test-health tracking: every result is appended to .automaqa/history.json,
 * the quarantine policy is applied, and the report gains a Test health section.
 * Flakiness needs history — a single run only tells you a test failed, not that it is
 * unreliable. See tests/support/flake-store.ts.
 *
 * Lifecycle:
 *   onBegin()   — record start time
 *   onTestEnd() — collect result (title, status, duration, retries) in memory
 *   onEnd()     — persist history, apply quarantine, write HTML from in-memory data
 *
 * Registered in playwright.config.ts as: ['./tests/versioned-reporter.ts']
 * globalTeardown is NOT used — reports are written here in onEnd().
 */

import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from '@playwright/test/reporter';
import * as fs   from 'fs';
import * as path from 'path';

import {
  type Store,
  type HealthSummary,
  type QuarantineChange,
  testId,
  loadStore,
  saveStore,
  record,
  applyQuarantinePolicy,
  summarise,
  formatHealthSummary,
} from './support/flake-store';

interface TestRecord {
  id:       string;
  title:    string;
  status:   string;
  duration: number;
  /** Retries Playwright needed. >0 with status "passed" means it flaked. */
  retries:  number;
  error?:   string;
}

class VersionedReporter implements Reporter {
  private records: TestRecord[] = [];
  private startTime             = 0;
  private suiteName             = '';

  onBegin(_config: FullConfig, suite: Suite): void {
    this.startTime = Date.now();
    // Derive feature slug from the first spec file found
    const firstFile = suite.allTests()[0]?.location?.file ?? '';
    const base      = path.basename(firstFile, '.spec.ts');   // e.g. "login-test-cases"
    this.suiteName  = base;
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const id = testId(test.location.file, suiteTitles(test));
    const entry: TestRecord = {
      id,
      title:    test.title,
      status:   result.status,
      duration: result.duration,
      retries:  result.retry,
      error:    result.error?.message,
    };

    // A retried test fires onTestEnd once per attempt. Keep only the final
    // attempt: recording every attempt would count one run several times and
    // skew the pass rate of precisely the flaky tests being measured.
    const prev = this.records.findIndex(r => r.id === id);
    if (prev === -1) this.records.push(entry);
    else if (result.retry >= this.records[prev].retries) this.records[prev] = entry;
  }

  /**
   * Append this run to the history file and apply the quarantine policy.
   * Failures here are reported but never fatal: losing health tracking must not
   * break a test run.
   */
  private updateHealth(): { summary: HealthSummary; changes: QuarantineChange[] } | null {
    try {
      const store: Store = loadStore();
      const at  = new Date().toISOString();
      const ref = process.env.GITHUB_SHA ?? process.env.BUILD_SOURCEVERSION ?? process.env.CI_COMMIT_SHA;

      for (const r of this.records) {
        // Skipped tests carry no signal, and recording them would dilute pass rates.
        if (r.status === 'skipped') continue;
        record(store, r.id, {
          at,
          outcome:  r.status === 'passed' ? 'passed' : 'failed',
          duration: r.duration,
          retries:  r.retries,
          ...(ref ? { ref } : {}),
        });
      }

      const changes = applyQuarantinePolicy(store);
      saveStore(store);
      return { summary: summarise(store), changes };
    } catch (err) {
      process.stderr.write(
        `  [health] tracking skipped: ${(err as Error).message}\n`,
      );
      return null;
    }
  }

  onEnd(_result: FullResult): void {
    if (!this.suiteName) return;

    const health = this.updateHealth();

    const outDir = path.join('specs', this.suiteName);
    fs.mkdirSync(outDir, { recursive: true });

    // Auto-increment version number
    const existing = fs.readdirSync(outDir).filter(f => /^report-v\d+\.html$/.test(f));
    const next     = existing.length + 1;
    const outFile  = path.join(outDir, `report-v${next}.html`);

    const total    = this.records.length;
    const passed   = this.records.filter(r => r.status === 'passed').length;
    const failed   = this.records.filter(r => r.status === 'failed').length;
    const skipped  = this.records.filter(r => r.status === 'skipped').length;
    const flaked   = this.records.filter(r => r.status === 'passed' && r.retries > 0).length;
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);

    const rows = this.records.map(r => {
      const badge =
        r.status === 'passed' && r.retries > 0
                               ? '<span class="badge flake">FLAKY</span>' :
        r.status === 'passed'  ? '<span class="badge pass">PASS</span>'  :
        r.status === 'failed'  ? '<span class="badge fail">FAIL</span>'  :
                                  '<span class="badge skip">SKIP</span>';
      const errorRow = r.error
        ? `<tr class="error-row"><td colspan="4"><pre>${escapeHtml(r.error.slice(0, 400))}</pre></td></tr>`
        : '';
      return `
        <tr>
          <td>${escapeHtml(r.title)}</td>
          <td>${badge}</td>
          <td>${(r.duration / 1000).toFixed(2)}s</td>
          <td>${r.retries > 0 ? `${r.retries} retry` : ''}${r.error ? ' ⚠' : ''}</td>
        </tr>${errorRow}`;
    }).join('');

    const healthHtml = renderHealth(health);

    const flakeBanner = flaked > 0
      ? `<div class="banner flake-banner">⚠ ${flaked} test(s) passed only after a retry — flaky, not green. See Test health below.</div>`
      : '';

    const failBanner = failed > 0
      ? `<div class="banner fail-banner">⛔ ${failed} test(s) FAILED — see rows below</div>`
      : `<div class="banner pass-banner">✅ All ${total} tests passed</div>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Report v${next} — ${this.suiteName}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 2rem; background: #f9fafb; color: #111; }
  h1   { font-size: 1.4rem; margin-bottom: .5rem; }
  .meta { font-size: .85rem; color: #666; margin-bottom: 1.5rem; }
  .cards { display: flex; gap: 1rem; margin-bottom: 1.5rem; flex-wrap: wrap; }
  .card  { background: #fff; border-radius: 8px; padding: .8rem 1.4rem; box-shadow: 0 1px 4px rgba(0,0,0,.1); min-width: 90px; text-align: center; }
  .card .num { font-size: 2rem; font-weight: 700; }
  .card .lbl { font-size: .75rem; color: #888; text-transform: uppercase; }
  .pass .num { color: #16a34a; }
  .fail .num { color: #dc2626; }
  .skip .num { color: #d97706; }
  .banner { padding: .8rem 1.2rem; border-radius: 6px; margin-bottom: 1.2rem; font-weight: 600; }
  .fail-banner { background: #fee2e2; color: #991b1b; }
  .pass-banner { background: #dcfce7; color: #166534; }
  table  { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,.1); }
  th, td { padding: .65rem 1rem; text-align: left; font-size: .9rem; }
  th     { background: #f1f5f9; font-weight: 600; font-size: .8rem; text-transform: uppercase; }
  tr:nth-child(even) { background: #f8fafc; }
  .badge { padding: .2rem .55rem; border-radius: 4px; font-size: .75rem; font-weight: 700; }
  .badge.pass { background: #dcfce7; color: #166534; }
  .badge.fail { background: #fee2e2; color: #991b1b; }
  .badge.skip { background: #fef9c3; color: #92400e; }
  .badge.flake { background: #fef3c7; color: #92400e; }
  .flake-banner { background: #fef3c7; color: #92400e; }
  .health { margin-top: 2rem; }
  .health h2 { font-size: 1.1rem; margin-bottom: .4rem; }
  .health .hint { font-size: .8rem; color: #666; margin: .3rem 0 .8rem; }
  .health section { margin-bottom: 1.2rem; }
  .health h3 { font-size: .85rem; text-transform: uppercase; color: #555; margin: 0 0 .4rem; }
  .health ul { margin: 0; padding-left: 1.1rem; font-size: .85rem; }
  .health li { margin-bottom: .25rem; }
  .health .why { color: #666; }
  .broken h3 { color: #991b1b; }
  .error-row td { background: #fff7f7; padding: .5rem 1rem; }
  .error-row pre { margin: 0; font-size: .8rem; color: #b91c1c; white-space: pre-wrap; word-break: break-word; }
</style>
</head>
<body>
<h1>📋 ${escapeHtml(this.suiteName)} — Report v${next}</h1>
<div class="meta">Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; Duration: ${duration}s</div>
<div class="cards">
  <div class="card"><div class="num">${total}</div><div class="lbl">Total</div></div>
  <div class="card pass"><div class="num">${passed}</div><div class="lbl">Passed</div></div>
  <div class="card fail"><div class="num">${failed}</div><div class="lbl">Failed</div></div>
  <div class="card skip"><div class="num">${skipped}</div><div class="lbl">Skipped</div></div>
  <div class="card"><div class="num">${duration}s</div><div class="lbl">Duration</div></div>
</div>
${failBanner}
${flakeBanner}
<table>
  <thead><tr><th>Test</th><th>Status</th><th>Duration</th><th>Notes</th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${healthHtml}
</body>
</html>`;

    fs.writeFileSync(outFile, html, 'utf-8');
    console.log(`\n📊 Report written → ${outFile}`);

    if (health) {
      const text = formatHealthSummary(health.summary);
      if (text) console.log(text);
      for (const c of health.changes) {
        const verb = c.action === 'quarantined' ? 'QUARANTINED' : 'RELEASED';
        console.log(`  [${verb}] ${c.id} — ${c.reason}`);
      }
    }
    console.log('');
  }
}

/** Render the Test health section, or nothing when the suite is healthy. */
function renderHealth(
  health: { summary: HealthSummary; changes: QuarantineChange[] } | null,
): string {
  if (!health) return '';
  const { summary, changes } = health;
  const { flakedThisRun, flakyOverTime, consistentlyFailing, quarantined } = summary;

  if (!flakedThisRun.length && !flakyOverTime.length && !consistentlyFailing.length
      && !quarantined.length && !changes.length) return '';

  const list = (title: string, items: string[], cls = '') =>
    items.length
      ? `<section class="${cls}"><h3>${escapeHtml(title)}</h3><ul>${items.join('')}</ul></section>`
      : '';

  const asItems = (verdicts: HealthSummary[keyof HealthSummary]) =>
    (verdicts as Array<{ id: string; reason: string }>).slice(0, 25).map(
      v => `<li><code>${escapeHtml(v.id)}</code><br><span class="why">${escapeHtml(v.reason)}</span></li>`,
    );

  const changeItems = changes.map(
    c => `<li><strong>${c.action === 'quarantined' ? 'Quarantined' : 'Released'}</strong> <code>${escapeHtml(c.id)}</code><br><span class="why">${escapeHtml(c.reason)}</span></li>`,
  );

  return `
<div class="health">
  <h2>Test health</h2>
  <div class="hint">
    Tracked tests: ${summary.totalTracked} &nbsp;|&nbsp;
    Flake rate: ${(summary.flakeRate * 100).toFixed(1)}%
  </div>
  ${list('Changed this run', changeItems)}
  ${list('Flaked in this run (passed only after a retry)', asItems(flakedThisRun))}
  ${list('Unreliable over time', asItems(flakyOverTime))}
  ${list('Consistently failing — real bugs, NOT quarantined', asItems(consistentlyFailing), 'broken')}
  ${list('Currently quarantined', asItems(quarantined))}
</div>`;
}

/**
 * Titles identifying the test within its file — Playwright's titlePath() begins
 * with the project name and the file name, both of which are already captured
 * elsewhere in the id, so including them would duplicate the filename.
 */
function suiteTitles(test: TestCase): string[] {
  const file = test.location.file.split(/[\\/]/).pop() ?? '';
  return test.titlePath().filter(t => Boolean(t) && t !== file);
}

function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export default VersionedReporter;
