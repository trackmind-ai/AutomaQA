#!/usr/bin/env node
/**
 * hook.js
 * ───────
 * Cross-platform hook notifier for the Testing plugin pipeline.
 * Drop-in JS replacement for the old hook script — no Python required.
 * Called by hooks/hooks.json after Write or Bash tool uses.
 *
 * Usage:
 *   node hook.js <event>
 *
 * Events:
 *   post_write              - after any file is written
 *   post_playwright_run     - after npx playwright test completes
 *   post_maestro_run        - after maestro test completes
 *   post_npm_install        - after npm install completes
 *   post_extract            - after extract_excel.js completes
 *   post_spec_build         - after spec builder completes
 *   pre_playwright_run      - before npx playwright test runs
 *   pre_maestro_run         - before maestro test runs
 */

'use strict';

const MESSAGES = {
  post_write: `\
[Testing] File written.
  If this was spec.md   -> The import-cases skill will prompt you to review. Do NOT start automation before user approves.
  If this was .spec.ts  -> Run:  npx playwright test --headed --trace on
  If this was .yaml     -> Run:  maestro test maestro/flows/<feature>.yaml
  If this was report.html -> Open: specs/<feature>/report.html`,

  post_playwright_run: `\
[Testing] Playwright run complete.
  -> Open report:   specs/<feature>/report-v{N}.html
  -> Any new failures found during automation must be added to the report immediately.`,

  post_maestro_run: `\
[Testing] Maestro run complete.
  -> Open report:   specs/<feature>/report.html
  -> If flows failed: use mcp_maestro_inspect_screen to re-read the device hierarchy and debug.`,

  post_npm_install: `\
[Testing] Node dependencies installed.
  -> Next: npx playwright install chromium`,

  post_extract: `\
[Testing] Excel extraction complete. raw_test_cases.json written.
  -> Next: run the import-cases skill to generate spec.md files.`,

  post_spec_build: `\
[Testing] Spec files built.
  -> IMPORTANT: Present every spec to the user for review.
  -> Do NOT start automation until the user explicitly approves the specs.`,

  pre_playwright_run: `\
[Testing] Playwright test starting.
  -> Report will be written to: specs/<feature>/report-v{N}.html
  -> Make sure Chrome is open with the Chrome DevTools MCP plugin connected.`,

  pre_maestro_run: `\
[Testing] Maestro flow starting.
  -> Make sure your emulator or physical device is booted and unlocked.
  -> If using Android: check AVD Manager. If using iOS: check Xcode Simulator.`,
};

const event   = process.argv[2] || '';
const message = MESSAGES[event];
if (message) console.log(message);
// Silently do nothing for unknown events — hooks are informational only
