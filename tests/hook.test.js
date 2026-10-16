#!/usr/bin/env node
/**
 * Tests for scripts/hooks/hook.js — the pipeline notifier printed after Write/Bash
 * tool uses.
 *
 * Run: node tests/hook.test.js
 *
 * This exists because of a real regression: after the plugin was renamed from
 * "Testing" to AutomaQA, every user-facing string was rebranded except this file —
 * it kept printing "[Testing]" on every hook fire. A second, related bug survived
 * in the same file: a comment referencing extract_excel.js, a script removed when
 * intake was generalised to extract_cases.js. Both slipped through because nothing
 * ran this script and inspected its output. This file is that check, permanently.
 */

'use strict';

const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'plugins', 'automaqa', 'scripts', 'hooks', 'hook.js');

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    process.stdout.write(`  ok    ${name}\n`);
  } catch (err) {
    failures.push({ name, message: err.message });
    process.stdout.write(`  FAIL  ${name}\n        ${err.message}\n`);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

/** Run hook.js for one event and return its stdout. */
function run(event) {
  return execFileSync(process.execPath, [SCRIPT, event], { encoding: 'utf8' });
}

const SOURCE = require('fs').readFileSync(SCRIPT, 'utf8');

// Every event hooks/hooks.json is known to fire, per hook.js's own header comment.
const KNOWN_EVENTS = [
  'post_write',
  'post_playwright_run',
  'post_maestro_run',
  'post_npm_install',
  'post_extract',
  'post_spec_build',
  'pre_playwright_run',
  'pre_maestro_run',
];

console.log('\nhook.js\n');

check('the file itself carries no retired branding or stale filenames', () => {
  assert(!/\bTesting\b/.test(SOURCE), 'source file still contains the retired "Testing" brand name');
  assert(!/extract_excel/.test(SOURCE), 'source file still references removed extract_excel.js/.py');
});

for (const event of KNOWN_EVENTS) {
  check(`${event}: prints a message with no retired branding or stale filenames`, () => {
    const out = run(event);
    assert(out.trim().length > 0, 'produced no output');
    assert(!/\bTesting\b/.test(out), `output still says "Testing": ${out.slice(0, 80)}`);
    assert(!/extract_excel/.test(out), `output still references extract_excel: ${out.slice(0, 80)}`);
    assert(/AutomaQA/.test(out), 'output does not carry the current AutomaQA brand');
  });
}

check('an unknown event produces no output and exits 0', () => {
  const out = execFileSync(process.execPath, [SCRIPT, 'not_a_real_event'], { encoding: 'utf8' });
  assert(out === '', `expected silence for an unknown event, got: ${JSON.stringify(out.slice(0, 80))}`);
});

check('no event argument produces no output and exits 0', () => {
  const out = execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert(out === '', `expected silence with no event argument, got: ${JSON.stringify(out.slice(0, 80))}`);
});

// ── pre/post routing: the hook must stay silent on unrelated tool uses ─────
function runPayload(phase, payload) {
  return execFileSync(process.execPath, [SCRIPT, phase], { encoding: 'utf8', input: JSON.stringify(payload) });
}
const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const write = (file_path) => ({ tool_name: 'Write', tool_input: { file_path } });

check('unrelated Bash commands print nothing (pre and post)', () => {
  for (const cmd of ['ls -la', 'git status', 'npm run build']) {
    assert(runPayload('pre', bash(cmd)) === '', `pre printed for: ${cmd}`);
    assert(runPayload('post', bash(cmd)) === '', `post printed for: ${cmd}`);
  }
});

check('unrelated file writes print nothing', () => {
  assert(runPayload('post', write('src/app.ts')) === '', 'printed for src/app.ts');
  assert(runPayload('post', write('README.md')) === '', 'printed for README.md');
});

check('playwright / maestro runs are routed to their pre and post messages', () => {
  assert(/Playwright test starting/.test(runPayload('pre', bash('npx playwright test --headed'))), 'pre playwright');
  assert(/Playwright run complete/.test(runPayload('post', bash('npx playwright test'))), 'post playwright');
  assert(/Maestro flow starting/.test(runPayload('pre', bash('maestro test flows/a.yaml'))), 'pre maestro');
  assert(/Maestro run complete/.test(runPayload('post', bash('maestro test flows/a.yaml'))), 'post maestro');
});

check('npm install and extract_cases are routed after the command only', () => {
  assert(/Node dependencies installed/.test(runPayload('post', bash('npm install'))), 'post npm install');
  assert(runPayload('pre', bash('npm install')) === '', 'pre npm install should be silent');
  assert(/Excel extraction complete/.test(runPayload('post', bash('node plugins/automaqa/scripts/pipeline/extract_cases.js x.xlsx'))), 'post extract');
});

check('spec, test and report writes are routed to the write message', () => {
  for (const f of ['specs/login/spec.md', 'tests/login.spec.ts', 'maestro/flows/login.yaml', 'specs/login/report-v2.html', String.raw`C:\p\specs\spec.md`]) {
    assert(/File written/.test(runPayload('post', write(f))), `no write message for ${f}`);
  }
});

check('malformed or empty stdin is silent and exits 0', () => {
  const out = execFileSync(process.execPath, [SCRIPT, 'post'], { encoding: 'utf8', input: 'not json' });
  assert(out === '', 'expected silence on bad stdin');
});

// ── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f.name}\n       ${f.message}`);
  process.exit(1);
}
