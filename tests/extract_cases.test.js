#!/usr/bin/env node
/**
 * Tests for scripts/pipeline/extract_cases.js — the multi-format intake.
 *
 * Run: node tests/extract_cases.test.js
 *
 * Every format gets a fixture written to a temp dir, parsed through the real
 * CLI, and asserted against. The messy-input cases are the important ones:
 * silently collecting garbage rows is worse than failing loudly.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'plugins', 'automaqa', 'scripts', 'pipeline', 'extract_cases.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'automaqa-intake-'));

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

function eq(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

/** Write a fixture and run the extractor over it. */
function run(filename, content, args = []) {
  const file = path.join(TMP, filename);
  fs.writeFileSync(file, content, 'utf8');
  const stdout = execFileSync(process.execPath, [SCRIPT, file, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
  return JSON.parse(stdout);
}

/** Run expecting a non-zero exit; returns stderr. */
function runExpectFailure(filename, content) {
  const file = path.join(TMP, filename);
  fs.writeFileSync(file, content, 'utf8');
  try {
    execFileSync(process.execPath, [SCRIPT, file], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    return String(err.stderr || '');
  }
  throw new Error('expected a non-zero exit, but the command succeeded');
}

const totalCases = (d) => d.features.reduce((n, f) => n + f.test_cases.length, 0);
const CANONICAL = ['id', 'type', 'scenario', 'steps', 'expected', 'precondition', 'test_data'];

console.log('\nextract_cases.js\n');

// ── Format coverage ─────────────────────────────────────────────────────────
console.log('formats');

check('csv: quoted multi-line cells and embedded quotes', () => {
  const d = run('a.csv',
    'TC ID,Scenario Type,Test Scenario,Test Steps,Expected Result\n' +
    'TC_001,Positive,Valid login,"1. Open /login\n2. Submit",Dashboard loads\n' +
    'TC_002,Negative,Bad password,Submit,"Error ""Invalid"" shown"\n');
  eq(d.source_format, 'csv', 'format');
  eq(totalCases(d), 2, 'case count');
  const [a, b] = d.features[0].test_cases;
  assert(a.steps.includes('1. Open /login') && a.steps.includes('2. Submit'), 'multi-line cell preserved');
  assert(b.expected.includes('"Invalid"'), 'escaped quotes decoded');
});

check('tsv: tab-delimited is auto-detected', () => {
  const d = run('a.tsv', 'Test ID\tSummary\tExpected\nT1\tSearch works\tResults shown\n');
  eq(totalCases(d), 1, 'case count');
  eq(d.features[0].test_cases[0].scenario, 'Search works', 'scenario');
});

check('json: nested step objects flatten into steps + expected', () => {
  const d = run('a.json', JSON.stringify({
    test_cases: [{
      key: 'LOGIN-1', summary: 'Valid login', suite: 'Login', priority: 'High',
      steps: [{ step: 'Open /login', expected: 'form visible' },
              { step: 'Submit creds', expected: 'dashboard' }],
    }],
  }));
  eq(totalCases(d), 1, 'case count');
  const c = d.features[0].test_cases[0];
  eq(c.id, 'LOGIN-1', 'id from key');
  assert(c.steps.includes('1. Open /login') && c.steps.includes('2. Submit creds'), 'steps numbered');
  assert(c.expected.includes('dashboard'), 'expected collected from steps');
});

check('json: cases group into features by suite', () => {
  const d = run('b.json', JSON.stringify({
    test_cases: [
      { key: 'L1', summary: 'Login', suite: 'Login' },
      { key: 'C1', summary: 'Cart', suite: 'Cart' },
    ],
  }));
  eq(d.features.length, 2, 'feature count');
  assert(d.features.map(f => f.name).sort().join(',') === 'Cart,Login', 'feature names');
});

check('json: the grouping field does not leak into type', () => {
  const d = run('c.json', JSON.stringify({
    test_cases: [{ key: 'L1', summary: 'Login', suite: 'Login', priority: 'High' }],
  }));
  const c = d.features[0].test_cases[0];
  eq(c.type, 'High', 'type comes from priority, not suite');
});

check('json: a bare top-level array is accepted', () => {
  const d = run('d.json', JSON.stringify([{ id: 'X1', title: 'Bare array', expected: 'ok' }]));
  eq(totalCases(d), 1, 'case count');
  eq(d.features[0].test_cases[0].id, 'X1', 'id');
});

check('gherkin: Given/When/Then map to precondition/steps/expected', () => {
  const d = run('a.feature',
    'Feature: Login\n' +
    '\n  Background:\n    Given the app is running\n' +
    '\n  @smoke @TC_101\n  Scenario: Valid login\n' +
    '    Given I am on the login page\n' +
    '    When I enter valid credentials\n' +
    '    Then I see the dashboard\n');
  eq(d.source_format, 'gherkin', 'format');
  const c = d.features[0].test_cases[0];
  eq(c.id, 'TC_101', 'id from tag');
  eq(c.type, 'smoke', 'non-id tags become type');
  assert(c.precondition.includes('the app is running'), 'background folded into precondition');
  assert(c.precondition.includes('I am on the login page'), 'given folded into precondition');
  assert(c.steps.includes('I enter valid credentials'), 'when becomes steps');
  assert(c.expected.includes('I see the dashboard'), 'then becomes expected');
});

check('gherkin: Scenario Outline captures Examples as test data', () => {
  const d = run('b.feature',
    'Feature: Login\n' +
    '\n  Scenario Outline: Invalid logins\n' +
    '    When I sign in with "<email>"\n    Then I see "<error>"\n' +
    '\n    Examples:\n' +
    '      | email     | error               |\n' +
    '      | bad@x.com | Invalid credentials |\n' +
    '      |           | Email is required   |\n');
  const c = d.features[0].test_cases[0];
  assert(c.test_data.includes('email=bad@x.com'), 'example row 1 captured');
  assert(c.test_data.includes('Email is required'), 'example row 2 captured');
});

check('markdown: one feature per heading, tables parsed', () => {
  const d = run('a.md',
    '# Login\n\n' +
    '| TC ID | Type | Test Scenario | Expected Result |\n|---|---|---|---|\n' +
    '| TC_001 | Positive | Valid login | Dashboard |\n\n' +
    '# Checkout\n\n' +
    '| TC ID | Type | Test Scenario | Expected Result |\n|---|---|---|---|\n' +
    '| TC_010 | Positive | Pay by card | Confirmed |\n');
  eq(d.features.length, 2, 'feature count');
  eq(d.features[0].name, 'Login', 'first feature name');
  eq(d.features[1].name, 'Checkout', 'second feature name');
});

check('markdown: heading + labelled prose when there is no table', () => {
  const d = run('b.md',
    '## TC_001 - Verify user can log in\n' +
    'Precondition: account exists\nSteps: open login, submit\nExpected: dashboard shown\n');
  const c = d.features[0].test_cases[0];
  eq(c.id, 'TC_001', 'id split from heading');
  eq(c.scenario, 'Verify user can log in', 'scenario split from heading');
  eq(c.precondition, 'account exists', 'precondition label');
  eq(c.expected, 'dashboard shown', 'expected label');
});

check('yaml: block scalars keep their line breaks', () => {
  const d = run('a.yaml',
    'feature: Login\n' +
    'test_cases:\n' +
    '  - id: TC_001\n' +
    '    type: Positive\n' +
    '    scenario: Valid login\n' +
    '    steps: |\n      1. Open /login\n      2. Submit creds\n' +
    '    expected: Dashboard loads\n');
  eq(d.source_format, 'yaml', 'format');
  eq(d.features[0].name, 'Login', 'feature name');
  const c = d.features[0].test_cases[0];
  eq(c.id, 'TC_001', 'id');
  assert(c.steps.includes('1. Open /login') && c.steps.includes('2. Submit creds'),
    'block scalar retained both lines');
});

check('xml: generic <case> elements are read', () => {
  const d = run('a.xml',
    '<?xml version="1.0"?><suite><name>Login Suite</name><cases>' +
    '<case><id>TC_001</id><title>Valid login</title><type>Positive</type>' +
    '<expected>Dashboard</expected></case></cases></suite>');
  eq(d.source_format, 'xml', 'format');
  eq(d.features[0].name, 'Login Suite', 'suite name');
  eq(d.features[0].test_cases[0].id, 'TC_001', 'id');
});

check('text: numbered prose list', () => {
  const d = run('a.txt',
    '1. Verify valid login\nSteps: open login, submit\nExpected: dashboard appears\n\n' +
    '2. Verify blank email rejected\nSteps: submit empty\nExpected: validation error\n');
  eq(totalCases(d), 2, 'case count');
  eq(d.features[0].test_cases[0].expected, 'dashboard appears', 'expected');
});

// ── Messy input: the "no wrong collection" guarantees ───────────────────────
console.log('\nmessy input');

check('a title row above the table does not become the header', () => {
  const d = run('messy1.csv',
    'Monthly Regression Report\n\n' +
    'TC ID,Test Scenario,Expected Result\n' +
    'TC1,Login works,dashboard\n');
  eq(totalCases(d), 1, 'only the real data row is collected');
  eq(d.features[0].test_cases[0].id, 'TC1', 'id read from the correct column');
  eq(d.features[0].raw_columns[0], 'TC ID', 'header row correctly identified');
});

check('semicolon delimiter is found despite a comma-free title line', () => {
  const d = run('messy2.csv',
    'Some Report Title\n\n' +
    'TC_ID;Test Case;Steps;Expected Result;Actual;Comments\n' +
    'TC1;Login works;do it;dashboard;pass;none\n' +
    'TC2;Logout works;click;home;pass;\n');
  eq(totalCases(d), 2, 'both rows collected as separate cases');
  const [a] = d.features[0].test_cases;
  eq(a.id, 'TC1', 'id');
  eq(a.scenario, 'Login works', 'scenario');
  eq(a.expected, 'dashboard', 'expected');
});

check('a header repeated mid-file is not collected as a case', () => {
  const d = run('messy3.csv',
    'TC ID,Test Scenario,Expected Result\n' +
    'TC1,Login works,dashboard\n' +
    'TC ID,Test Scenario,Expected Result\n' +
    'TC2,Logout works,home\n');
  eq(totalCases(d), 2, 'the repeated header is skipped');
  assert(!d.features[0].test_cases.some(c => c.scenario === 'Test Scenario'),
    'no case was created from the header row');
});

check('unrecognised trailing columns are dropped, not mapped', () => {
  const d = run('messy4.csv',
    'TC ID,Test Scenario,Expected Result,Actual Result,Comments,Tester\n' +
    'TC1,Login,dashboard,passed,none,alice\n');
  const c = d.features[0].test_cases[0];
  eq(c.expected, 'dashboard', 'expected is the spec value, not the actual result');
  assert(!Object.values(c).includes('alice'), 'tester name did not leak into a field');
});

check('blank rows are skipped', () => {
  const d = run('messy5.csv',
    'TC ID,Test Scenario,Expected Result\n' +
    'TC1,Login,dashboard\n' +
    ',,\n' +
    'TC2,Logout,home\n');
  eq(totalCases(d), 2, 'blank row ignored');
});

check('header synonyms from other tools are recognised', () => {
  const d = run('messy6.csv',
    'Key,Summary,Preconditions,Test Procedure,Acceptance Criteria\n' +
    'JIRA-1,Login flow,user exists,open and submit,dashboard loads\n');
  const c = d.features[0].test_cases[0];
  eq(c.id, 'JIRA-1', 'Key -> id');
  eq(c.scenario, 'Login flow', 'Summary -> scenario');
  eq(c.precondition, 'user exists', 'Preconditions -> precondition');
  eq(c.steps, 'open and submit', 'Test Procedure -> steps');
  eq(c.expected, 'dashboard loads', 'Acceptance Criteria -> expected');
});

check('every case carries the full canonical field set', () => {
  const d = run('shape.csv', 'TC ID,Test Scenario\nTC1,Minimal case\n');
  const c = d.features[0].test_cases[0];
  for (const key of CANONICAL) {
    assert(key in c, `missing canonical field '${key}'`);
    eq(typeof c[key], 'string', `field '${key}' should be a string`);
  }
});

check('pipes in cell values are escaped for Markdown safety', () => {
  const d = run('pipe.csv', 'TC ID,Test Scenario,Expected Result\nTC1,"A | B split",ok\n');
  assert(d.features[0].test_cases[0].scenario.includes('\\|'), 'pipe escaped');
});

// ── Detection and failure modes ─────────────────────────────────────────────
console.log('\ndetection and failures');

check('a file with no extension is sniffed by content', () => {
  const d = run('noext', 'TC ID,Test Scenario,Expected Result\nA1,No extension,ok\n');
  eq(d.source_format, 'csv', 'sniffed as csv');
  eq(totalCases(d), 1, 'case count');
});

check('--format overrides detection', () => {
  const d = run('actually.txt', '## TC_9 - Forced markdown\nExpected: works\n', ['--format=markdown']);
  eq(d.source_format, 'markdown', 'forced format honoured');
});

check('an unknown --format is rejected', () => {
  const file = path.join(TMP, 'x.csv');
  fs.writeFileSync(file, 'TC ID,Test Scenario\nA,B\n');
  let stderr = '';
  try {
    execFileSync(process.execPath, [SCRIPT, file, '--format=banana'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    throw new Error('expected failure');
  } catch (err) {
    stderr = String(err.stderr || '');
  }
  assert(/Unknown --format/.test(stderr), `expected an unknown-format error, got: ${stderr.slice(0, 120)}`);
});

check('an empty file fails loudly', () => {
  const stderr = runExpectFailure('empty.csv', '');
  assert(/empty/i.test(stderr), `expected an "empty" error, got: ${stderr.slice(0, 120)}`);
});

check('unstructured junk fails rather than inventing cases', () => {
  const stderr = runExpectFailure('junk.txt', 'just some random prose with no structure at all\n');
  assert(/No test cases found/i.test(stderr), `expected a no-cases error, got: ${stderr.slice(0, 120)}`);
});

check('a missing file reports not found', () => {
  let stderr = '';
  try {
    execFileSync(process.execPath, [SCRIPT, path.join(TMP, 'does-not-exist.csv')],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    throw new Error('expected failure');
  } catch (err) {
    stderr = String(err.stderr || '');
  }
  assert(/not found/i.test(stderr), `expected a not-found error, got: ${stderr.slice(0, 120)}`);
});

check('no positional argument prints usage and exits 2', () => {
  let code = 0, stderr = '';
  try {
    execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    code = err.status;
    stderr = String(err.stderr || '');
  }
  eq(code, 2, 'exit code');
  assert(/Usage:/.test(stderr), 'usage printed');
});

// ── Summary ────────────────────────────────────────────────────────────────
fs.rmSync(TMP, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failures.length} failed\n`);
if (failures.length) {
  for (const f of failures) console.log(`  FAIL ${f.name}\n       ${f.message}`);
  process.exit(1);
}
