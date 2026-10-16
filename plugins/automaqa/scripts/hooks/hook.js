#!/usr/bin/env node
/**
 * hook.js
 * ───────
 * Cross-platform hook notifier for the AutomaQA plugin pipeline.
 * Drop-in JS replacement for the old hook script — no Python required.
 * Called by hooks/hooks.json before/after Write or Bash tool uses.
 *
 * Usage:
 *   node hook.js pre | post     (from hooks.json — reads the hook payload on stdin)
 *   node hook.js <event>        (print one event's message directly)
 *
 * In pre/post mode the event is picked from the tool payload: only an AutomaQA-relevant
 * command (playwright test, maestro test, npm install, extract_cases) or file write
 * (spec.md, *.spec.ts, Maestro *.yaml, report*.html) prints anything. Every other Bash
 * call or Write stays silent, so the plugin adds no noise to unrelated work.
 *
 * Events:
 *   post_write              - after any file is written
 *   post_playwright_run     - after npx playwright test completes
 *   post_maestro_run        - after maestro test completes
 *   post_npm_install        - after npm install completes
 *   post_extract            - after extract_cases.js completes
 *   post_spec_build         - after spec builder completes
 *   pre_playwright_run      - before npx playwright test runs
 *   pre_maestro_run         - before maestro test runs
 */

'use strict';

const MESSAGES = {
  post_write: `\
[AutomaQA] File written.
  If this was spec.md   -> The import-cases skill will prompt you to review. Do NOT start automation before user approves.
  If this was .spec.ts  -> Run:  npx playwright test --headed --trace on
  If this was .yaml     -> Run:  maestro test maestro/flows/<feature>.yaml
  If this was report.html -> Open: specs/<feature>/report.html`,

  post_playwright_run: `\
[AutomaQA] Playwright run complete.
  -> Open report:   specs/<feature>/report-v{N}.html
  -> Any new failures found during automation must be added to the report immediately.`,

  post_maestro_run: `\
[AutomaQA] Maestro run complete.
  -> Open report:   specs/<feature>/report.html
  -> If flows failed: use mcp_maestro_inspect_screen to re-read the device hierarchy and debug.`,

  post_npm_install: `\
[AutomaQA] Node dependencies installed.
  -> Next: npx playwright install chromium`,

  post_extract: `\
[AutomaQA] Excel extraction complete. raw_test_cases.json written.
  -> Next: run the import-cases skill to generate spec.md files.`,

  post_spec_build: `\
[AutomaQA] Spec files built.
  -> IMPORTANT: Present every spec to the user for review.
  -> Do NOT start automation until the user explicitly approves the specs.`,

  pre_playwright_run: `\
[AutomaQA] Playwright test starting.
  -> Report will be written to: specs/<feature>/report-v{N}.html
  -> Make sure Chrome is open with the Chrome DevTools MCP plugin connected.`,

  pre_maestro_run: `\
[AutomaQA] Maestro flow starting.
  -> Make sure your emulator or physical device is booted and unlocked.
  -> If using Android: check AVD Manager. If using iOS: check Xcode Simulator.`,
};

/** Pick the event for a hook payload, or '' when the tool use is unrelated to AutomaQA. */
function route(phase, payload) {
  const input = (payload && payload.tool_input) || {};
  if (payload && payload.tool_name === 'Write') {
    const file = String(input.file_path || '').replace(/\\/g, '/');
    const relevant = /(^|\/)spec\.md$|\.spec\.ts$|\.ya?ml$|(^|\/)report[^/]*\.html$/i.test(file);
    return phase === 'post' && relevant ? 'post_write' : '';
  }
  const cmd = String(input.command || '');
  if (/\bplaywright\s+test\b/.test(cmd)) return `${phase}_playwright_run`;
  if (/\bmaestro\s+test\b/.test(cmd)) return `${phase}_maestro_run`;
  if (phase === 'post' && /\bextract_cases\.js\b/.test(cmd)) return 'post_extract';
  if (phase === 'post' && /\bnpm\s+(install|i|ci)\b/.test(cmd)) return 'post_npm_install';
  return '';
}

function readStdin() {
  try {
    return JSON.parse(require('fs').readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

const arg   = process.argv[2] || '';
const event = arg === 'pre' || arg === 'post' ? route(arg, readStdin()) : arg;
const message = MESSAGES[event];
if (message) console.log(message);
// Silently do nothing for unknown events — hooks are informational only
