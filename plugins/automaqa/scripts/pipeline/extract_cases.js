#!/usr/bin/env node
/**
 * extract_cases.js
 * ────────────────
 * Universal test-case intake. Reads whatever a tester hands you and emits one
 * canonical JSON shape for the spec builder.
 *
 * Supported inputs (auto-detected by extension, then by content sniffing):
 *
 *   .xlsx .xlsm .xls   Excel workbook      — one feature per sheet
 *   .csv .tsv          Delimited text      — one feature (delimiter auto-detected)
 *   .json              JSON                — array, {test_cases}, {features}, or
 *                                            Zephyr / TestRail / Xray export shapes
 *   .md .markdown      Markdown            — GFM tables, or `## heading` + prose
 *   .feature           Gherkin             — Scenario / Scenario Outline + Examples
 *   .yaml .yml         YAML                — list of cases or {features:[...]}
 *   .txt               Plain text          — numbered or bulleted case list
 *   .xml               XML                 — TestRail / Xray / generic <testcase>
 *
 * Usage:
 *   node extract_cases.js <input_path> [output_json_path] [--verbose] [--format=<fmt>]
 *
 * `--format` forces a parser when auto-detection guesses wrong.
 *
 * Output JSON (identical for every input format):
 * {
 *   "source_file": "Login.xlsx",
 *   "source_format": "xlsx",
 *   "features": [
 *     {
 *       "name": "Login",
 *       "raw_columns": ["TC ID", "Test Scenario", ...],   // [] when not tabular
 *       "test_cases": [
 *         { "id": "TC_001", "type": "Positive", "scenario": "...",
 *           "steps": "...", "expected": "...", "precondition": "", "test_data": "" }
 *       ]
 *     }
 *   ],
 *   "warnings": ["..."]
 * }
 *
 * Exit codes: 0 success · 1 hard error (unreadable/unparseable) · 2 bad usage
 *
 * Only `xlsx` (SheetJS) is required, and only for Excel inputs. Every other
 * format is parsed with the Node standard library — no extra dependencies.
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// ─────────────────────────────────────────────
// Canonical field contract
// ─────────────────────────────────────────────
const CANONICAL_FIELDS = ['id', 'type', 'scenario', 'steps', 'expected', 'precondition', 'test_data'];

/** Synonyms → canonical field. Extend here when a new tool's export appears. */
const COLUMN_MAP = {
  // ── ID
  'tc id': 'id', 'tc_id': 'id', 'tcid': 'id', 'test id': 'id', 'test_id': 'id',
  'id': 'id', 'case id': 'id', 'case_id': 'id', 'key': 'id', 'issue key': 'id',
  'testcase id': 'id', 'test case id': 'id', 'ref': 'id', 'reference': 'id',
  'sr no': 'id', 'sr. no': 'id', 's.no': 'id', 'sno': 'id',

  // ── Type / category
  'test type': 'type', 'scenario type': 'type', 'type': 'type', 'category': 'type',
  'test category': 'type', 'case type': 'type', 'priority': 'type',
  'severity': 'type', 'test level': 'type', 'suite': 'type', 'section': 'type',
  'labels': 'type', 'tags': 'type',

  // ── Scenario / title
  'test scenario': 'scenario', 'test scenarios': 'scenario', 'scenario': 'scenario',
  'test case': 'scenario', 'testcase': 'scenario', 'test name': 'scenario',
  'title': 'scenario', 'summary': 'scenario', 'name': 'scenario',
  'description': 'scenario', 'test description': 'scenario',
  'objective': 'scenario', 'test objective': 'scenario', 'case name': 'scenario',

  // ── Steps
  'test steps': 'steps', 'steps': 'steps', 'step': 'steps',
  'step description': 'steps', 'steps to reproduce': 'steps',
  'action': 'steps', 'actions': 'steps', 'test procedure': 'steps',
  'procedure': 'steps', 'how to test': 'steps', 'step actions': 'steps',

  // ── Expected result
  'expected result': 'expected', 'expected results': 'expected', 'expected': 'expected',
  'result': 'expected', 'expected outcome': 'expected', 'expected behaviour': 'expected',
  'expected behavior': 'expected', 'acceptance criteria': 'expected',
  'expected value': 'expected', 'assertion': 'expected', 'then': 'expected',

  // ── Pre-condition
  'pre-condition': 'precondition', 'precondition': 'precondition',
  'pre condition': 'precondition', 'preconditions': 'precondition',
  'pre-conditions': 'precondition', 'prerequisites': 'precondition',
  'prerequisite': 'precondition', 'setup': 'precondition',
  'given': 'precondition', 'context': 'precondition',

  // ── Test data
  'test data': 'test_data', 'test_data': 'test_data', 'data': 'test_data',
  'sample data': 'test_data', 'input data': 'test_data', 'input': 'test_data',
  'inputs': 'test_data', 'parameters': 'test_data', 'test inputs': 'test_data',
  'test values': 'test_data',
};

const ALLOWED_CANONICAL = new Set(CANONICAL_FIELDS);

/** Header-ish first cells, used to spot repeated headers in merged sheets. */
const HEADER_TRIGGERS = new Set([
  'tc id', 'tc_id', 'test id', 'id', 'no', '#', 'sr no', 'sr. no', 's.no', 'sno', 'key',
]);

const warnings = [];
let VERBOSE = false;

function warn(msg) {
  warnings.push(msg);
  if (VERBOSE) process.stderr.write(`  [WARN] ${msg}\n`);
}
function note(msg) {
  if (VERBOSE) process.stderr.write(`  [INFO] ${msg}\n`);
}
function fatal(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

// ─────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────

function normalise(text) {
  return (text == null ? '' : String(text)).trim().toLowerCase();
}

/** Clean a value into a string that is safe inside a Markdown table cell. */
function clean(val) {
  if (val == null) return '';
  let text = String(val).trim();
  text = text.replace(/\r\n/g, '\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  text = text.replace(/\|/g, '\\|');
  return text;
}

/** Fill in any missing canonical keys so downstream code can rely on them. */
function completeCase(tc) {
  for (const key of CANONICAL_FIELDS) {
    if (!(key in tc) || tc[key] == null) tc[key] = '';
    else tc[key] = clean(tc[key]);
  }
  return tc;
}

/** A case is worth keeping if it has a scenario or an id. */
function isUsableCase(tc) {
  return Boolean(tc.scenario || tc.id);
}

/** Map an arbitrary header cell to a canonical field, or null to ignore it. */
function canonicalFor(headerCell) {
  const raw = normalise(headerCell);
  if (!raw) return null;
  if (COLUMN_MAP[raw]) return COLUMN_MAP[raw];
  if (ALLOWED_CANONICAL.has(raw)) return raw;
  // Loose contains-match, so "Expected Result (UI)" still lands correctly.
  for (const [needle, canonical] of Object.entries(COLUMN_MAP)) {
    if (raw.includes(needle)) return canonical;
  }
  return null;
}

/** Build { canonicalKey: columnIndex } from a header row. */
function detectColumns(headerRow) {
  const mapping = {};
  headerRow.forEach((cell, idx) => {
    const canonical = canonicalFor(cell);
    if (!canonical) {
      if (normalise(cell)) note(`Column '${clean(cell)}' is not a recognised field — ignored`);
      return;
    }
    if (!(canonical in mapping)) mapping[canonical] = idx;
    else warn(`Duplicate column for '${canonical}' — keeping the first, ignoring '${clean(cell)}'`);
  });
  return mapping;
}

function looksLikeHeaderRow(rowVals) {
  return HEADER_TRIGGERS.has(normalise(rowVals[0]));
}

/**
 * Turn a rows-of-cells grid into a feature. Shared by Excel, CSV and Markdown
 * tables so all three behave identically.
 */
function scoreHeaderRow(row) {
  let recognised = 0, filled = 0;
  const seen = new Set();
  for (const cell of row) {
    const text = normalise(cell);
    if (!text) continue;
    filled++;
    // Long prose or a sentence is data, not a header.
    if (text.length > 60 || /[.!?]$/.test(text)) continue;
    const canonical = canonicalFor(cell);
    if (canonical && !seen.has(canonical)) { seen.add(canonical); recognised++; }
  }
  if (!filled) return { score: -1, recognised: 0 };
  // Reward recognised fields; mildly penalise rows that are mostly unmapped.
  return { score: recognised * 10 - (filled - recognised), recognised };
}

/**
 * Pick the real header row. Report titles, blank rows and merged banners often
 * sit above it, so score the first several rows and take the best rather than
 * assuming row 0. Guessing wrong here silently collects garbage test cases.
 */
function findHeaderRow(rows) {
  const limit = Math.min(rows.length, 25);
  let bestIdx = -1, best = { score: 0, recognised: 0 };
  for (let i = 0; i < limit; i++) {
    const s = scoreHeaderRow(rows[i]);
    // Require at least two recognised fields to call it a header.
    if (s.recognised >= 2 && s.score > best.score) { best = s; bestIdx = i; }
  }
  if (bestIdx !== -1) return bestIdx;
  // Fall back to a single recognised field.
  for (let i = 0; i < limit; i++) {
    if (scoreHeaderRow(rows[i]).recognised >= 1) return i;
  }
  return -1;
}

/**
 * Turn a rows-of-cells grid into a feature. Shared by Excel, CSV and Markdown
 * tables so all three behave identically.
 */
function gridToFeature(rows, featureName) {
  if (!rows.length) return null;

  const headerIdx = findHeaderRow(rows);
  if (headerIdx === -1) {
    warn(`'${featureName}' has no recognisable test-case header row — skipped`);
    return null;
  }
  if (headerIdx > 0) {
    note(`'${featureName}': header found on row ${headerIdx + 1}; ${headerIdx} row(s) above it ignored`);
  }

  const headerRow = rows[headerIdx].map(clean);
  const colMap = detectColumns(headerRow);

  if (!Object.keys(colMap).length) {
    warn(`'${featureName}' has no recognisable test-case columns — skipped`);
    return null;
  }
  if (!('scenario' in colMap)) {
    warn(`'${featureName}' has no scenario/title column; ids will carry the case names`);
  }

  // A row repeating the header's recognised labels is a duplicate header.
  const headerSignature = new Set(
    headerRow.map(c => normalise(c)).filter(c => c && canonicalFor(c)),
  );
  const isRepeatedHeader = (rowVals) => {
    const labels = rowVals.map(c => normalise(c)).filter(Boolean);
    if (labels.length < 2) return false;
    const hits = labels.filter(l => headerSignature.has(l)).length;
    return hits >= 2 && hits >= Math.ceil(labels.length / 2);
  };

  const testCases = [];
  let skippedBlank = 0, skippedHeaderish = 0;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const rowVals = rows[r].map(clean);
    if (!rowVals.some(Boolean)) { skippedBlank++; continue; }
    if (looksLikeHeaderRow(rowVals) || isRepeatedHeader(rowVals)) { skippedHeaderish++; continue; }

    const tc = {};
    for (const [canonical, idx] of Object.entries(colMap)) {
      tc[canonical] = idx < rowVals.length ? rowVals[idx] : '';
    }
    completeCase(tc);
    if (isUsableCase(tc)) testCases.push(tc);
  }

  if (skippedHeaderish) note(`'${featureName}': ignored ${skippedHeaderish} repeated header row(s)`);
  if (!testCases.length) {
    note(`'${featureName}' yielded no test cases`);
    return null;
  }

  return { name: featureName, raw_columns: headerRow.filter(Boolean), test_cases: testCases };
}

// ─────────────────────────────────────────────
// Parser: Excel
// ─────────────────────────────────────────────
function parseExcel(filePath) {
  let XLSX;
  try {
    XLSX = require('xlsx');
  } catch {
    fatal('Excel input needs the xlsx package. Run: npm install xlsx');
  }

  let wb;
  try {
    wb = XLSX.readFile(filePath, { cellDates: false, raw: false });
  } catch (err) {
    fatal(err.code === 'ENOENT'
      ? `File not found: ${filePath}`
      : `Could not open workbook '${filePath}': ${err.message}`);
  }

  const features = [];
  for (const sheetName of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1, defval: null, raw: false,
    });
    const feature = gridToFeature(rows, sheetName.trim() || 'Sheet');
    if (feature) features.push(feature);
  }
  return features;
}

// ─────────────────────────────────────────────
// Parser: CSV / TSV
// ─────────────────────────────────────────────

/**
 * Pick the delimiter. Sampling several lines matters: a report title or banner
 * above the table often contains no delimiter at all, and judging by the first
 * line alone picks the wrong one and collapses every row into a single column.
 */
function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 30);
  if (!lines.length) return ',';
  const candidates = [',', '\t', ';', '|'];

  let best = ',', bestScore = -1;
  for (const d of candidates) {
    const counts = lines.map(l => splitDelimited(l, d).length);
    const max = Math.max(...counts);
    if (max < 2) continue;
    // Prefer the delimiter giving the most columns, consistently across lines.
    const consistent = counts.filter(c => c === max).length;
    const score = max * 100 + consistent;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** RFC4180-aware single-line split (quotes, escaped quotes). */
function splitDelimited(line, delim) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Split full CSV text into rows, honouring newlines inside quoted cells. */
function parseDelimitedText(text, delim) {
  const rows = [];
  let row = [], cur = '', inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(cur); cur = '';
    } else if (ch === '\n') {
      row.push(cur); rows.push(row); row = []; cur = '';
    } else if (ch === '\r') {
      // handled by the \n branch
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim()));
}

function parseCsv(filePath, forcedDelim) {
  const text = fs.readFileSync(filePath, 'utf8');
  const delim = forcedDelim || sniffDelimiter(text);
  note(`delimiter detected: ${JSON.stringify(delim)}`);
  const rows = parseDelimitedText(text, delim);
  const featureName = path.basename(filePath).replace(/\.[^.]+$/, '');
  const feature = gridToFeature(rows, featureName);
  return feature ? [feature] : [];
}

// ─────────────────────────────────────────────
// Parser: JSON (native + Zephyr / TestRail / Xray exports)
// ─────────────────────────────────────────────

/** Map one loose object to a canonical case using key synonyms. */
function objectToCase(obj) {
  const tc = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value == null || typeof value === 'object') continue;
    const canonical = canonicalFor(key);
    if (canonical && !tc[canonical]) tc[canonical] = value;
  }

  // Structured steps: [{step, expected}] or ["do x", "do y"]
  const stepsField = obj.steps || obj.test_steps || obj.testSteps || obj.custom_steps_separated;
  if (Array.isArray(stepsField)) {
    const stepLines = [], expectedLines = [];
    stepsField.forEach((s, i) => {
      if (s && typeof s === 'object') {
        const action = s.step || s.action || s.description || s.content || '';
        const exp = s.expected || s.expectedResult || s.expected_result || '';
        if (action) stepLines.push(`${i + 1}. ${action}`);
        if (exp) expectedLines.push(exp);
      } else if (s) {
        stepLines.push(`${i + 1}. ${s}`);
      }
    });
    if (stepLines.length) tc.steps = stepLines.join('\n');
    if (expectedLines.length && !tc.expected) tc.expected = expectedLines.join('\n');
  }

  return completeCase(tc);
}

function parseJson(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    fatal(`'${path.basename(filePath)}' is not valid JSON: ${err.message}`);
  }

  const fallbackName = path.basename(filePath).replace(/\.[^.]+$/, '');

  // Already in our shape — pass through, re-normalising each case.
  if (data && Array.isArray(data.features)) {
    return data.features.map(f => {
      const cases = (f.test_cases || f.testCases || [])
        .map(objectToCase).filter(isUsableCase);
      return cases.length
        ? { name: f.name || fallbackName, raw_columns: f.raw_columns || [], test_cases: cases }
        : null;
    }).filter(Boolean);
  }

  // A bare array, or a wrapper around one.
  const listCandidates = [
    data,
    data && data.test_cases, data && data.testCases,
    data && data.cases, data && data.tests,
    data && data.results, data && data.values,   // Zephyr/Xray pagination
    data && data.issues,                         // Jira/Xray
  ];
  const list = listCandidates.find(Array.isArray);

  if (!list) {
    fatal('Could not find a test-case array in the JSON. Expected an array, or a '
        + '{test_cases|cases|tests|values|issues|features} property containing one.');
  }

  // Group by whichever field looks like a feature/suite name.
  const groups = new Map();
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const src = raw.fields && typeof raw.fields === 'object' ? { ...raw, ...raw.fields } : raw;
    const groupName = clean(
      src.feature || src.suite || src.section || src.folder ||
      src.component || src.module || src.epic || fallbackName,
    ) || fallbackName;
    // Fields consumed as the feature/group name must not also become the case type.
    const grouped = { ...src };
    for (const k of ['feature', 'suite', 'section', 'folder', 'component', 'module', 'epic']) {
      if (clean(grouped[k]) === groupName) delete grouped[k];
    }
    const tc = objectToCase(grouped);
    if (!isUsableCase(tc)) continue;
    if (!groups.has(groupName)) groups.set(groupName, []);
    groups.get(groupName).push(tc);
  }

  return [...groups.entries()].map(([name, test_cases]) => ({
    name, raw_columns: [], test_cases,
  }));
}

// ─────────────────────────────────────────────
// Parser: Markdown (GFM tables, or headings + prose)
// ─────────────────────────────────────────────

function splitMarkdownTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  // Split on unescaped pipes.
  return s.split(/(?<!\\)\|/).map(c => c.trim().replace(/\\\|/g, '|'));
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(line) && line.includes('-');
}

function parseMarkdown(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const fallbackName = path.basename(filePath).replace(/\.[^.]+$/, '');

  const features = [];
  let currentHeading = fallbackName;
  let tableBuffer = [];

  const flushTable = () => {
    if (tableBuffer.length < 2) { tableBuffer = []; return; }
    const rows = tableBuffer.filter(l => !isTableSeparator(l)).map(splitMarkdownTableRow);
    const feature = gridToFeature(rows, currentHeading);
    if (feature) features.push(feature);
    tableBuffer = [];
  };

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(line);
    if (headingMatch) {
      flushTable();
      currentHeading = clean(headingMatch[2]) || fallbackName;
      continue;
    }
    if (/^\s*\|/.test(line)) { tableBuffer.push(line); continue; }
    flushTable();
  }
  flushTable();

  if (features.length) return features;

  // No tables — fall back to prose under headings.
  note('no Markdown tables found; parsing headings and prose');
  return parseProse(text, fallbackName);
}

/**
 * Heading/prose fallback. Each `## heading` becomes a case; recognised
 * `Label:` lines inside it fill the canonical fields.
 */
function parseProse(text, fallbackName) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const cases = [];
  let cur = null;

  const push = () => {
    if (cur && isUsableCase(cur)) cases.push(completeCase(cur));
    cur = null;
  };

  for (const line of lines) {
    const heading = /^(?:#{1,6}\s+|\s*(?:\d+[.)]|[-*+])\s+)(.*)$/.exec(line);
    const labelled = /^\s*[-*+]?\s*([A-Za-z][A-Za-z \-_/]{2,30}?)\s*[:：]\s*(.+)$/.exec(line);

    // A labelled line inside an open case fills a field rather than starting one.
    if (labelled && cur) {
      const canonical = canonicalFor(labelled[1]);
      if (canonical) {
        cur[canonical] = cur[canonical] ? `${cur[canonical]}\n${labelled[2].trim()}` : labelled[2].trim();
        continue;
      }
    }

    if (heading && heading[1].trim()) {
      const title = heading[1].trim();
      // "TC_001 - Verify login" → split id from scenario.
      const withId = /^([A-Z][A-Z0-9_\-.]{2,})\s*[-–:]\s*(.+)$/.exec(title);
      push();
      cur = withId
        ? { id: withId[1], scenario: withId[2].trim() }
        : { scenario: title };
      continue;
    }

    if (labelled && !cur) {
      const canonical = canonicalFor(labelled[1]);
      if (canonical) {
        cur = {};
        cur[canonical] = labelled[2].trim();
      }
      continue;
    }

    // Continuation prose becomes steps.
    if (cur && line.trim()) {
      cur.steps = cur.steps ? `${cur.steps}\n${line.trim()}` : line.trim();
    }
  }
  push();

  if (!cases.length) {
    fatal('No test cases found. Provide a table, a JSON array, Gherkin scenarios, '
        + 'or headings of the form "## TC_001 - Verify ..." with "Steps:"/"Expected:" lines.');
  }
  return [{ name: fallbackName, raw_columns: [], test_cases: cases }];
}

// ─────────────────────────────────────────────
// Parser: Gherkin .feature
// ─────────────────────────────────────────────
function parseGherkin(filePath) {
  const text = fs.readFileSync(filePath, 'utf8').replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const fallbackName = path.basename(filePath).replace(/\.[^.]+$/, '');

  let featureName = fallbackName;
  let background = [];
  const cases = [];

  let cur = null;             // { scenario, given[], when[], then[], tags[], outline }
  let exampleHeader = null;
  let collectingExamples = false;

  const finish = () => {
    if (!cur) return;
    const pre = [...background, ...cur.given].join('\n');
    const steps = cur.when.length ? cur.when.join('\n') : cur.given.join('\n');
    cases.push(completeCase({
      id: cur.id || '',
      type: cur.tags.join(', '),
      scenario: cur.scenario,
      steps,
      expected: cur.then.join('\n'),
      precondition: pre,
      test_data: cur.examples.length ? cur.examples.join('\n') : '',
    }));
    cur = null;
    exampleHeader = null;
    collectingExamples = false;
  };

  let pendingTags = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('@')) {
      pendingTags = line.split(/\s+/).filter(t => t.startsWith('@')).map(t => t.slice(1));
      continue;
    }

    let m;
    if ((m = /^Feature:\s*(.*)$/i.exec(line))) {
      finish();
      featureName = clean(m[1]) || fallbackName;
      continue;
    }
    if ((m = /^Background:/i.exec(line))) {
      finish();
      background = [];
      cur = null;
      collectingExamples = false;
      // Subsequent Given lines with no open scenario accumulate into background.
      continue;
    }
    if ((m = /^(Scenario Outline|Scenario Template|Scenario|Example):\s*(.*)$/i.exec(line))) {
      finish();
      const title = clean(m[2]);
      // A tag like @TC_001 is an id, not a category.
      const idTag = pendingTags.find(t => /^[A-Z]+[-_]?\d+$/i.test(t));
      cur = {
        scenario: title || 'Unnamed scenario',
        id: idTag || '',
        tags: pendingTags.filter(t => t !== idTag),
        given: [], when: [], then: [], examples: [],
      };
      pendingTags = [];
      continue;
    }
    if (/^(Examples|Scenarios):/i.exec(line)) {
      collectingExamples = true;
      exampleHeader = null;
      continue;
    }

    // Example data table
    if (collectingExamples && line.startsWith('|')) {
      const cells = splitMarkdownTableRow(line);
      if (!exampleHeader) {
        exampleHeader = cells;
      } else if (cur) {
        const pairs = cells.map((c, i) => `${exampleHeader[i] || `col${i + 1}`}=${c}`);
        cur.examples.push(pairs.join(', '));
      }
      continue;
    }

    // Steps
    if ((m = /^(Given|When|Then|And|But|\*)\s+(.*)$/i.exec(line))) {
      const keyword = m[1].toLowerCase();
      const body = m[2].trim();
      if (!cur) {
        // Before any scenario → Background.
        background.push(body);
        continue;
      }
      if (keyword === 'given') cur.lastBucket = 'given';
      else if (keyword === 'when') cur.lastBucket = 'when';
      else if (keyword === 'then') cur.lastBucket = 'then';
      const bucket = cur.lastBucket || 'when';
      cur[bucket].push(body);
      continue;
    }

    // A data table attached to a step
    if (cur && line.startsWith('|')) {
      const bucket = cur.lastBucket || 'when';
      cur[bucket].push(line);
    }
  }
  finish();

  if (!cases.length) fatal(`No scenarios found in '${path.basename(filePath)}'.`);
  return [{ name: featureName, raw_columns: [], test_cases: cases }];
}

// ─────────────────────────────────────────────
// Parser: YAML (minimal — list of cases or {features:[]})
// ─────────────────────────────────────────────

/**
 * Small YAML subset reader: nested maps, `- ` lists, scalars, and `|`/`>` blocks.
 * Enough for hand-written test-case files without pulling in a YAML dependency.
 */
function parseYamlSubset(text) {
  const rawLines = text.replace(/\r\n/g, '\n').split('\n');

  // Pre-tokenise: keep only meaningful lines with their indent.
  const toks = [];
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    if (!line.trim() || /^\s*#/.test(line) || line.trim() === '---' || line.trim() === '...') continue;
    toks.push({ indent: line.match(/^\s*/)[0].length, text: line.trim(), raw: line, lineNo: i });
  }

  const scalar = (v) => {
    let s = String(v).trim();
    if (!s) return '';
    if (s.startsWith('#')) return '';
    // Strip a trailing inline comment outside quotes.
    if (!/^["']/.test(s)) s = s.replace(/\s+#.*$/, '').trim();
    if ((s.startsWith('"') && s.endsWith('"') && s.length > 1) ||
        (s.startsWith("'") && s.endsWith("'") && s.length > 1)) {
      return s.slice(1, -1);
    }
    if (/^(true|false)$/i.test(s)) return s.toLowerCase() === 'true';
    if (/^(null|~)$/i.test(s)) return '';
    return s;
  };

  const KV = /^([^:#][^:]*?)\s*:\s*(.*)$/;

  /** Consume a block scalar (| or >) starting after index i. Returns [text, nextIndex]. */
  function readBlock(i, parentIndent, style) {
    const out = [];
    let j = i + 1;
    for (; j < toks.length; j++) {
      if (toks[j].indent <= parentIndent) break;
      out.push(toks[j].text);
    }
    return [out.join(style.startsWith('|') ? '\n' : ' ').trim(), j - 1];
  }

  /**
   * Parse a mapping whose keys sit at exactly `indent`, starting at toks[i].
   * Returns [object, nextIndex].
   */
  function parseMap(i, indent) {
    const obj = {};
    let idx = i;
    while (idx < toks.length) {
      const t = toks[idx];
      if (t.indent < indent) break;
      if (t.indent > indent) { idx++; continue; }   // stray deeper line
      if (t.text.startsWith('- ') || t.text === '-') break;

      const m = KV.exec(t.text);
      if (!m) { idx++; continue; }
      const key = m[1].trim();
      const val = m[2];

      if (/^[|>][-+]?$/.test(val.trim())) {
        const [blockText, last] = readBlock(idx, indent, val.trim());
        obj[key] = blockText;
        idx = last + 1;
        continue;
      }

      if (val.trim() === '') {
        // Nested block: a list or a deeper map.
        const next = toks[idx + 1];
        if (next && next.indent > indent && (next.text.startsWith('- ') || next.text === '-')) {
          const [arr, last] = parseList(idx + 1, next.indent);
          obj[key] = arr;
          idx = last;
        } else if (next && next.indent > indent) {
          const [child, last] = parseMap(idx + 1, next.indent);
          obj[key] = child;
          idx = last;
        } else {
          obj[key] = '';
          idx++;
        }
        continue;
      }

      obj[key] = scalar(val);
      idx++;
    }
    return [obj, idx];
  }

  /**
   * Parse a sequence whose `-` markers sit at exactly `indent`.
   * Returns [array, nextIndex].
   */
  function parseList(i, indent) {
    const arr = [];
    let idx = i;
    while (idx < toks.length) {
      const t = toks[idx];
      if (t.indent < indent) break;
      if (t.indent > indent) { idx++; continue; }
      if (!(t.text.startsWith('- ') || t.text === '-')) break;

      const rest = t.text === '-' ? '' : t.text.slice(2).trim();

      if (!rest) {
        const next = toks[idx + 1];
        if (next && next.indent > indent) {
          const [child, last] = parseMap(idx + 1, next.indent);
          arr.push(child);
          idx = last;
        } else { arr.push(''); idx++; }
        continue;
      }

      const m = KV.exec(rest);
      if (m) {
        // Inline first key of a map item; sibling keys are indented under it.
        const itemIndent = indent + 2;
        const item = {};
        const key = m[1].trim();
        const val = m[2];

        if (/^[|>][-+]?$/.test(val.trim())) {
          const [blockText, last] = readBlock(idx, indent, val.trim());
          item[key] = blockText;
          idx = last + 1;
        } else if (val.trim() === '') {
          item[key] = '';
          idx++;
        } else {
          item[key] = scalar(val);
          idx++;
        }

        // Absorb the remaining keys of this item.
        if (idx < toks.length && toks[idx].indent >= itemIndent &&
            !toks[idx].text.startsWith('- ')) {
          const [rest2, last] = parseMap(idx, toks[idx].indent);
          Object.assign(item, rest2);
          idx = last;
        }
        arr.push(item);
        continue;
      }

      arr.push(scalar(rest));
      idx++;
    }
    return [arr, idx];
  }

  if (!toks.length) return {};
  const baseIndent = toks[0].indent;
  if (toks[0].text.startsWith('- ') || toks[0].text === '-') {
    const [arr] = parseList(0, baseIndent);
    return { test_cases: arr };
  }
  const [obj] = parseMap(0, baseIndent);
  return obj;
}


function parseYaml(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const data = parseYamlSubset(text);
  const fallbackName = path.basename(filePath).replace(/\.[^.]+$/, '');

  if (Array.isArray(data.features)) {
    return data.features.map(f => {
      const cases = (f.test_cases || f.cases || []).map(objectToCase).filter(isUsableCase);
      return cases.length ? { name: clean(f.name) || fallbackName, raw_columns: [], test_cases: cases } : null;
    }).filter(Boolean);
  }

  const list = [data.test_cases, data.cases, data.tests, data.scenarios].find(Array.isArray);
  if (!list) {
    fatal('Could not find a test-case list in the YAML. Expected a '
        + '{test_cases|cases|tests|scenarios} list, or {features: [...]}.');
  }
  const cases = list.map(objectToCase).filter(isUsableCase);
  if (!cases.length) fatal('The YAML list contained no usable test cases.');
  return [{ name: clean(data.feature || data.name) || fallbackName, raw_columns: [], test_cases: cases }];
}

// ─────────────────────────────────────────────
// Parser: XML (TestRail / Xray / generic)
// ─────────────────────────────────────────────

function stripTags(s) {
  return s.replace(/<[^>]*>/g, ' ')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseXml(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const fallbackName = path.basename(filePath).replace(/\.[^.]+$/, '');

  // Grab each <case>/<testcase>/<test> block, however it is named.
  const blockRe = /<(case|testcase|test|Test|TestCase)\b[^>]*>([\s\S]*?)<\/\1>/g;
  const blocks = [...text.matchAll(blockRe)];

  if (!blocks.length) fatal(`No <case>/<testcase>/<test> elements found in '${path.basename(filePath)}'.`);

  const suiteMatch = /<(?:name|suite|title)>([^<]+)<\/(?:name|suite|title)>/i.exec(text);
  const featureName = suiteMatch ? clean(suiteMatch[1]) : fallbackName;

  const cases = [];
  for (const [, , body] of blocks) {
    const tc = {};
    // Direct child elements → fields.
    for (const m of body.matchAll(/<([A-Za-z_][\w.-]*)\b[^>]*>([\s\S]*?)<\/\1>/g)) {
      const canonical = canonicalFor(m[1]);
      if (canonical && !tc[canonical]) tc[canonical] = stripTags(m[2]);
    }
    // Attribute-style fields on the element itself.
    for (const m of body.matchAll(/(\w+)\s*=\s*"([^"]*)"/g)) {
      const canonical = canonicalFor(m[1]);
      if (canonical && !tc[canonical]) tc[canonical] = m[2];
    }
    completeCase(tc);
    if (isUsableCase(tc)) cases.push(tc);
  }

  if (!cases.length) fatal('XML contained no usable test cases.');
  return [{ name: featureName, raw_columns: [], test_cases: cases }];
}

// ─────────────────────────────────────────────
// Parser: plain text
// ─────────────────────────────────────────────
function parseText(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const fallbackName = path.basename(filePath).replace(/\.[^.]+$/, '');

  // A .txt that is really a delimited table.
  const firstLine = text.split(/\r?\n/).find(l => l.trim()) || '';
  if (/[,\t;|]/.test(firstLine)) {
    const delim = sniffDelimiter(text);
    const rows = parseDelimitedText(text, delim);
    const feature = gridToFeature(rows, fallbackName);
    if (feature) {
      note('plain text parsed as a delimited table');
      return [feature];
    }
  }
  return parseProse(text, fallbackName);
}

// ─────────────────────────────────────────────
// Format detection
// ─────────────────────────────────────────────
const EXT_FORMAT = {
  '.xlsx': 'xlsx', '.xlsm': 'xlsx', '.xls': 'xlsx',
  '.csv': 'csv', '.tsv': 'csv',
  '.json': 'json',
  '.md': 'markdown', '.markdown': 'markdown',
  '.feature': 'gherkin',
  '.yaml': 'yaml', '.yml': 'yaml',
  '.xml': 'xml',
  '.txt': 'text',
};

/** Content sniffing for unknown or missing extensions. */
function sniffFormat(filePath) {
  let head;
  try {
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(4096);
    const bytes = fs.readSync(fd, buf, 0, 4096, 0);
    fs.closeSync(fd);
    head = buf.slice(0, bytes);
  } catch (err) {
    fatal(`Could not read '${filePath}': ${err.message}`);
  }

  // XLSX is a zip; legacy XLS has its own OLE signature.
  if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx';
  if (head[0] === 0xd0 && head[1] === 0xcf) return 'xlsx';

  const asText = head.toString('utf8');
  const trimmed = asText.replace(/^﻿/, '').trimStart();

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (trimmed.startsWith('<?xml') || trimmed.startsWith('<')) return 'xml';
  if (/^\s*(@\w|Feature\s*:)/im.test(trimmed)) return 'gherkin';
  if (/^\s*\|/m.test(trimmed) || /^#{1,6}\s/m.test(trimmed)) return 'markdown';
  if (/^\s*[\w.-]+\s*:\s*($|\S)/m.test(trimmed) && /^\s*-\s/m.test(trimmed)) return 'yaml';
  if (/[,\t;|]/.test(trimmed.split('\n')[0] || '')) return 'csv';
  return 'text';
}

function detectFormat(filePath, forced) {
  if (forced) {
    const f = forced.toLowerCase().replace(/^\./, '');
    const alias = { excel: 'xlsx', xls: 'xlsx', xlsm: 'xlsx', tsv: 'csv', md: 'markdown', yml: 'yaml', txt: 'text' };
    const resolved = alias[f] || f;
    const known = new Set(['xlsx', 'csv', 'json', 'markdown', 'gherkin', 'yaml', 'xml', 'text']);
    if (!known.has(resolved)) {
      fatal(`Unknown --format '${forced}'. Use one of: ${[...known].join(', ')}.`);
    }
    return resolved;
  }
  const ext = path.extname(filePath).toLowerCase();
  if (EXT_FORMAT[ext]) return EXT_FORMAT[ext];
  const sniffed = sniffFormat(filePath);
  note(`extension '${ext || '(none)'}' unrecognised — sniffed as ${sniffed}`);
  return sniffed;
}

const PARSERS = {
  xlsx: parseExcel,
  csv: parseCsv,
  json: parseJson,
  markdown: parseMarkdown,
  gherkin: parseGherkin,
  yaml: parseYaml,
  xml: parseXml,
  text: parseText,
};

// ─────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────
function extract(filePath, forcedFormat) {
  if (!fs.existsSync(filePath)) fatal(`File not found: ${filePath}`);
  const stat = fs.statSync(filePath);
  if (stat.isDirectory()) fatal(`'${filePath}' is a directory. Pass a single file.`);
  if (stat.size === 0) fatal(`'${filePath}' is empty.`);

  const format = detectFormat(filePath, forcedFormat);
  note(`parsing as ${format}`);

  const features = PARSERS[format](filePath);
  if (!features.length) {
    fatal('No test cases were extracted. Check that the file has a recognisable '
        + 'header row or case structure, or force a parser with --format.');
  }

  // Report totals so a tester can sanity-check the intake immediately.
  const total = features.reduce((n, f) => n + f.test_cases.length, 0);
  note(`extracted ${total} case(s) across ${features.length} feature(s)`);

  return {
    source_file: path.basename(filePath),
    source_format: format,
    features,
    warnings,
  };
}

function main() {
  const args = process.argv.slice(2);
  VERBOSE = args.includes('--verbose');

  const formatArg = args.find(a => a.startsWith('--format='));
  const forcedFormat = formatArg ? formatArg.split('=')[1] : null;
  const posArgs = args.filter(a => !a.startsWith('--'));

  if (!posArgs.length) {
    console.error(
      'Usage: node extract_cases.js <input_path> [output_json_path] [--verbose] [--format=<fmt>]\n' +
      '\n' +
      'Formats: xlsx, csv, json, markdown, gherkin, yaml, xml, text (auto-detected).',
    );
    process.exit(2);
  }

  const inputPath = posArgs[0];
  const outputPath = posArgs[1] || null;

  const data = extract(inputPath, forcedFormat);

  let jsonStr;
  try {
    jsonStr = JSON.stringify(data, null, 2);
  } catch (err) {
    fatal(`Failed to serialise data to JSON: ${err.message}`);
  }

  if (outputPath) {
    try {
      const outDir = path.dirname(outputPath);
      if (outDir) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outputPath, jsonStr, 'utf8');
    } catch (err) {
      fatal(`Could not write output file '${outputPath}': ${err.message}`);
    }
    const total = data.features.reduce((n, f) => n + f.test_cases.length, 0);
    console.log(
      `Extracted ${total} test case(s) in ${data.features.length} feature(s) ` +
      `from ${data.source_format} -> ${outputPath}`,
    );
    if (warnings.length) console.log(`${warnings.length} warning(s); re-run with --verbose for detail.`);
  } else {
    process.stdout.write(jsonStr + '\n');
  }
}

if (require.main === module) main();

module.exports = { extract, detectFormat, canonicalFor, CANONICAL_FIELDS };
