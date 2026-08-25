---
description: Interactive full environment setup — installs and verifies Playwright, Maestro CLI, the Maestro and Chrome DevTools MCP plugins, Node deps, and browser drivers on Windows and macOS/Linux. Also prepares a dedicated Chrome remote-debugging profile for live web verification. Run this once on a new machine or whenever the environment needs repair.
when_to_use: Use when the user wants to set up the testing environment, install Playwright, install Maestro, install or fix the Chrome DevTools MCP or Maestro MCP plugin, configure the project for the first time, or repair a broken setup. Trigger on "set up testing", "install playwright", "install maestro", "install chrome devtools mcp", "chrome devtools not connecting", "configure environment", "setup", "first time setup", "set up project".
argument-hint: [web | mobile | both (default: both)]
---

# Full Environment Setup

Sets up the complete testing toolchain in the **user's project directory (cwd)**.
Detects what is already present, installs only what is missing, and prints a final status table.

---

## Plugin vs User Project — Two Directories

| Directory | What lives there |
|---|---|
| **Plugin root** (`${CLAUDE_PLUGIN_ROOT}`) | Skills, helper scripts, project templates — **never modified by users** |
| **User's cwd** | `package.json`, `playwright.config.ts`, `tests/`, `specs/`, `maestro/` — **everything setup creates** |

Setup reads template files from the plugin root and creates/copies them into the user's cwd.

---

## Step 0: Detect Operating System and Scope

### Detect OS

```bash
# Mac/Linux — prints "Darwin" or "Linux"
uname -s
```

```powershell
# Windows — prints "Windows_NT"
[System.Environment]::OSVersion.Platform
```

If `uname -s` fails, the platform is Windows. Store as `OS` (`windows`, `mac`, or `linux`).

All steps below show commands labelled **Windows** or **Mac/Linux** — run only the one matching `OS`.

### Determine Scope

Ask the user (or infer from context):

> "Do you need setup for **web only** (Playwright), **mobile only** (Maestro), or **both**?"

Default to **both** if not specified. Store as `SETUP_SCOPE`.

---

## Step 1: Check and Install Node.js _(skip if SETUP_SCOPE = mobile)_

**Windows & Mac/Linux:**
```bash
node -v
npm -v
```

| Result | Action |
|---|---|
| Version printed | Already installed — continue |
| Command not found | Install from https://nodejs.org (LTS). Windows: `.msi` installer. Mac: `.pkg` or `brew install node`. |

After installing, re-run to confirm.

---

## Step 2: Install Node Project Dependencies _(skip if SETUP_SCOPE = mobile)_

Check if `package.json` exists in the user's cwd:

**Windows:**
```powershell
Test-Path package.json
```
**Mac/Linux:**
```bash
ls package.json
```

**If it exists** — restore dependencies:
```bash
npm install
```

**If it does not exist** — initialise the project and install required packages:
```bash
npm init -y
npm install --save-dev @playwright/test typescript ts-node
npm install xlsx
```

The `package.json` must contain:
```json
{
  "devDependencies": {
    "@playwright/test": "^1.60.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.0.0"
  },
  "dependencies": {
    "xlsx": "^0.18.5"
  }
}
```

Confirm Playwright installed:
```bash
npx playwright --version
```

---

## Step 3: Install Playwright Browser Drivers _(skip if SETUP_SCOPE = mobile)_

**Windows & Mac/Linux:**
```bash
npx playwright install chromium
```

On **Linux CI only** (not needed on Windows or Mac):
```bash
npx playwright install --with-deps
```

Confirm:
```bash
npx playwright --version
```

---

## Step 4: Create Required Directory Structure _(skip if SETUP_SCOPE = mobile)_

Create any missing directories in the user's cwd:

**Windows:**
```powershell
New-Item -ItemType Directory -Force -Path "tests\e2e", "tests\support", "specs", "pages\components", "pages\support", "screens", "maestro\flows", "maestro\subflows"
```

**Mac/Linux:**
```bash
mkdir -p tests/e2e tests/support specs pages/components pages/support screens maestro/flows maestro/subflows
```

**Directories explained:**
| Directory | Purpose |
|---|---|
| `tests/e2e/` | Playwright spec files — behaviour only, never locators |
| `tests/` | Also holds `versioned-reporter.ts` (copied in Step 5) |
| `tests/support/` | `flake-store.ts` and `quarantine.ts` — test-health tracking (Step 5d) |
| `specs/` | Feature spec.md files and HTML reports go here |
| `pages/` | Web page objects — the ONLY place web locators live |
| `pages/components/` | Reusable widget objects (nav, tables, modals) |
| `pages/support/` | `healing-locator.ts` and other shared helpers (copied in Step 5c) |
| `screens/` | Mobile screen objects — the ONLY place element ids live |
| `maestro/flows/` | Maestro YAML flow files that compose screens |
| `maestro/subflows/` | Reusable Maestro sub-flows |

> `test-results/` is **NOT created** — it is not needed. The versioned-reporter writes directly to `specs/<slug>/report-v{N}.html` using in-memory data, with no intermediate JSON file.

---

## Step 5: Set Up the Versioned Reporter _(skip if SETUP_SCOPE = mobile)_

The versioned reporter is a custom Playwright Reporter that automatically generates `specs/<slug>/report-v{N}.html` after every test run. It ships inside the plugin and must be copied into the user's project.

### 5a — Copy `versioned-reporter.ts` into the user's project

Check if it already exists:

**Windows:**
```powershell
Test-Path tests\versioned-reporter.ts
```
**Mac/Linux:**
```bash
ls tests/versioned-reporter.ts
```

If it **does not exist**, copy from the plugin:

**Windows:**
```powershell
Copy-Item "${CLAUDE_PLUGIN_ROOT}\templates\tests\versioned-reporter.ts" -Destination "tests\versioned-reporter.ts"
```
**Mac/Linux:**
```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/tests/versioned-reporter.ts" tests/versioned-reporter.ts
```

If it **already exists**, no action needed — continue.

### 5c — Copy `healing-locator.ts` into the user's project

Self-healing locators need the shared helper. Check and copy:

**Windows:**
```powershell
if (-not (Test-Path pages\support\healing-locator.ts)) {
  Copy-Item "${CLAUDE_PLUGIN_ROOT}\templates\pages\support\healing-locator.ts" -Destination "pages\support\healing-locator.ts"
}
```
**Mac/Linux:**
```bash
[ -f pages/support/healing-locator.ts ] || \
  cp "${CLAUDE_PLUGIN_ROOT}/templates/pages/support/healing-locator.ts" pages/support/healing-locator.ts
```

> **What healing-locator.ts does:** exports `heal(page, element, candidates)`, which tries
> ranked locator candidates and returns the first matching **exactly one** element. A
> candidate matching several is refused, never guessed at — guessing can make a test pass
> against the wrong element. Every fallback used is recorded in `healEvents` and printed,
> so drift is visible instead of silently absorbed. See `automaqa:self-healing`.

Verify TypeScript can resolve Node globals — the helper and reporter both use them:

```bash
node -e "require.resolve('@types/node'); console.log('@types/node OK')"
```

If that fails, run `npm install --save-dev @types/node`.

### 5d — Copy the test-health helpers

Flake detection needs two files in `tests/support/`.

**Windows:**
```powershell
foreach ($f in "flake-store.ts", "quarantine.ts") {
  if (-not (Test-Path "tests\support\$f")) {
    Copy-Item "${CLAUDE_PLUGIN_ROOT}\templates\tests\support\$f" -Destination "tests\support\$f"
  }
}
```
**Mac/Linux:**
```bash
for f in flake-store.ts quarantine.ts; do
  [ -f "tests/support/$f" ] || \
    cp "${CLAUDE_PLUGIN_ROOT}/templates/tests/support/$f" "tests/support/$f"
done
```

> **What these do:** `flake-store.ts` keeps per-test outcome history in
> `.automaqa/history.json` and classifies each test as healthy, flaky, or broken.
> `quarantine.ts` is a fixture that skips quarantined tests so they stop blocking CI.
> A consistently-failing test is never quarantined — that would hide a real bug.
> See `automaqa:flake-guard`.

Tell the user to add `.automaqa/history.json` to version control if tests run in CI —
without shared history every CI run starts blind, and no inter-run flake is ever detected.

> **What versioned-reporter.ts does:**
> A custom Reporter class registered in `playwright.config.ts`. Playwright calls its methods in this order:
> 1. `onBegin()` — records the run start time
> 2. `onTestEnd()` — collects each test result (title, status, duration, error) in memory
> 3. `onEnd()` — writes `specs/<slug>/report-v{N}.html` from the collected data
>
> Reports are written entirely from in-memory data — no intermediate JSON file, no timing dependency.
> N auto-increments by counting existing `report-v*.html` files in `specs/<slug>/`.

### 5b — Verify or Create `playwright.config.ts`

Check if `playwright.config.ts` exists in the user's cwd:

**Windows:**
```powershell
Test-Path playwright.config.ts
```
**Mac/Linux:**
```bash
ls playwright.config.ts
```

**If it does not exist**, copy the shipped template:

**Windows:**
```powershell
Copy-Item "${CLAUDE_PLUGIN_ROOT}\templates\playwright.config.ts" -Destination "playwright.config.ts"
```
**Mac/Linux:**
```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/playwright.config.ts" playwright.config.ts
```

The template is reproduced below for reference — if the copy fails, create the file with the Write tool using this exact content:

```typescript
import { defineConfig } from '@playwright/test';

/**
 * playwright.config.ts
 * ─────────────────────
 * Central configuration for all Playwright E2E runs.
 *
 * REPORT ARCHITECTURE
 * ───────────────────
 * Reports are generated by tests/versioned-reporter.ts — a custom Reporter
 * class registered below. It writes specs/<slug>/report-v{N}.html in its
 * onEnd() callback, using in-memory data collected during the run.
 *
 * globalTeardown is NOT used for reports. It is not registered here.
 *
 * FILE NAMING CONVENTION
 * ──────────────────────
 *   tests/e2e/<feature-slug>.spec.ts  →  specs/<feature-slug>/report-v{N}.html
 *   report-v1.html  = first automated run
 *   report-v2.html  = second run, and so on
 *   report.html     = manual live-verification report (never overwritten)
 */

export default defineConfig({
  testDir: './tests/e2e',

  // ── Execution ───────────────────────────────────────────────────────────────
  maxFailures:   0,     // NEVER stop early — every test always runs
  // One retry in CI SURFACES flakiness: Playwright marks such tests "flaky" and the
  // reporter records retries>0. Locally 0, so flakiness is visible while you work.
  // Never raise this to make a suite green — see the flake-guard skill.
  retries:       process.env.CI ? 1 : 0,
  workers:       1,     // single worker — prevents concurrent auth collisions
  fullyParallel: false,

  // ── Reporters ───────────────────────────────────────────────────────────────
  //   list               → live terminal output while tests run
  //   versioned-reporter → writes specs/<slug>/report-v{N}.html after each run
  //
  // globalTeardown is NOT registered here and is NOT used for reports.
  reporter: [
    ['list'],
    ['./tests/versioned-reporter.ts'],
  ],

  // ── Browser defaults ────────────────────────────────────────────────────────
  use: {
    headless:           false,               // headed during development
    screenshot:         'on',               // capture for every test
    trace:              'retain-on-failure', // trace zip only on failures
    video:              'off',
    // NO storageState — every test starts with a completely fresh, cookie-free context
  },
});
```

**If it already exists**, read it and verify these settings are present and correct. Apply any missing settings with the Edit tool — do **not** overwrite the entire file:

| Setting | Required value | Why |
|---|---|---|
| `testDir` | `'./tests/e2e'` | All spec files live here |
| `maxFailures` | `0` | Every test must always run, never stop early |
| `workers` | `1` | Serial execution prevents auth collisions |
| `fullyParallel` | `false` | |
| `reporter` | `['list']` + `['./tests/versioned-reporter.ts']` | Live output + HTML reports |
| `screenshot` | `'on'` | Capture for every test |
| `trace` | `'retain-on-failure'` | |
| `globalTeardown` | **must NOT be set** | globalTeardown is a no-op; remove it if present |
| `json reporter` | **must NOT be set** | Not needed; reporter generates HTML directly |

> ⚠️ **If `globalTeardown` or a `json` reporter entry is present in the config, remove them.** They are from the old architecture and will not generate reports. The versioned-reporter registered above is the only mechanism needed.

---

## Step 6: Verify xlsx (SheetJS) is installed _(always — needed if any input is Excel)_

The intake script (`scripts/pipeline/extract_cases.js`) is pure JavaScript — no Python required. It reads Excel, CSV/TSV, JSON, Markdown, Gherkin, YAML, XML, and plain text; only the Excel path needs the `xlsx` package.

**Windows & Mac/Linux:**
```bash
node -e "require('xlsx'); console.log('xlsx OK')"
```

If that fails:
```bash
npm install xlsx
```

---

## Step 7: Install Maestro CLI _(skip if SETUP_SCOPE = web)_

**Windows & Mac/Linux:**
```bash
maestro --version
```

If installed, continue. If not installed:

### macOS / Linux
```bash
curl -Ls "https://get.maestro.mobile.dev" | bash
export PATH="$PATH:$HOME/.maestro/bin"
```

Add the `export PATH` line to `~/.zshrc` or `~/.bashrc` to make it permanent, then `source` the file.

Verify:
```bash
maestro --version
```

### Windows

**Option 1 — Scoop (recommended):**
```powershell
scoop install maestro
maestro --version
```

**Option 2 — Manual install:**
1. Download from https://github.com/mobile-dev-inc/maestro/releases
2. Extract and copy `maestro.exe` to e.g. `C:\maestro\bin\`
3. Add to PATH:
   ```powershell
   [System.Environment]::SetEnvironmentVariable("PATH", $env:PATH + ";C:\maestro\bin", "User")
   ```
4. Restart terminal, then verify:
   ```powershell
   maestro --version
   ```

**Java required on Windows:** Maestro needs Java 11+.
```powershell
java -version
```
If missing: https://adoptium.net (Eclipse Temurin LTS). Tick "Set JAVA_HOME" during install.

---

## Step 8: Install the Maestro MCP Plugin _(skip if SETUP_SCOPE = web)_

There are two independent things needed for mobile automation to work in Claude Code, and both must be present — installed is not the same as connected, and connected is not the same as installed:

1. **The Maestro MCP server itself** (a CLI-level registration — `claude mcp add`)
2. **The MCP tools being loaded into the current Claude Code session** (requires a restart after step 1)

Check whether the server is already registered:
```bash
claude mcp list
```

If `maestro` appears in the list, skip registration and go to Step 9. If not:
```bash
claude mcp add --scope user maestro maestro mcp
```

> ⚠️ Tell the user: **"Maestro MCP registered globally. Restart Claude Code for it to take effect — MCP servers load only at startup, never mid-session."**

---

## Step 9: Verify Maestro MCP Connection _(skip if SETUP_SCOPE = web)_

Attempt `mcp__maestro__list_devices`:
- **Returns (even an empty list)** → connected ✓. An empty list is expected on a fresh machine — tell the user to boot an emulator/simulator or connect a device before running mobile tests.
- **Tool does not exist / is unavailable** → this means the registration in Step 8 has not taken effect in *this* session yet.
  - If Step 8 just ran → tell the user to fully quit and reopen Claude Code (not just close the window), then re-run this check.
  - If `claude mcp list` does not show `maestro` at all → re-run Step 8; the registration itself did not happen.
  - If `claude mcp list` **does** show `maestro` but the tool is still unavailable after a restart → the plugin may be disabled. Tell the user to run `/plugin`, find `maestro` in the list, and confirm it is enabled.

---

## Step 10: Install the Chrome DevTools MCP Plugin _(skip if SETUP_SCOPE = mobile)_

Same two-layer distinction as Step 8 applies here — a plugin that is *cached on disk* from a previous install is not the same as one *loaded into this session*.

Check whether the Chrome DevTools MCP tools are already available by attempting a call such as `list_pages`. If any Chrome DevTools MCP tool responds (even with an error about no open page), it is loaded — skip to Step 11.

If no Chrome DevTools MCP tool exists in this session at all, install the plugin:
```bash
claude plugin install chrome-devtools-mcp
```

> ⚠️ Tell the user: **"Chrome DevTools MCP plugin installed. Restart Claude Code for it to take effect — MCP servers load only at startup, never mid-session."**

If the install command reports the plugin is already installed but its tools still are not showing up, the plugin is present but disabled or not yet loaded in this session — tell the user to run `/plugin`, find `chrome-devtools-mcp` in the list, confirm it is enabled, and restart Claude Code either way.

Do not stop setup for this — proceed to Step 11 to prepare the browser side regardless of the plugin's state, since the user will need it the moment the plugin does connect.

---

## Step 11: Prepare Chrome for Remote Debugging _(skip if SETUP_SCOPE = mobile)_

Modern Chrome **refuses** `--remote-debugging-port` on its default profile directory for security reasons — it must be pointed at a separate, dedicated profile. This is a common failure that looks like "Chrome DevTools MCP won't connect" but is actually Chrome silently rejecting the flag.

### Locate Chrome

Do not assume a fixed path — resolve it properly, since installs land in different places per machine (per-user vs. system-wide) and a Start Menu shortcut is often the only reliable pointer on Windows.

**Windows:**
```powershell
$chrome = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $chrome) {
  $lnk = "C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Google Chrome.lnk"
  if (Test-Path $lnk) {
    $chrome = (New-Object -COM WScript.Shell).CreateShortcut($lnk).TargetPath
  }
}

if ($chrome) { Write-Host "Found: $chrome" }
else { Write-Host "Chrome not found — install from https://www.google.com/chrome" }
```

**Mac:**
```bash
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -f "$CHROME" ] && echo "Found: $CHROME" || echo "Chrome not found — install from https://www.google.com/chrome"
```

**Linux:**
```bash
command -v google-chrome && echo "Found" || echo "Chrome not found — install from https://www.google.com/chrome"
```

### Check whether it is already running with debugging enabled

```bash
curl -s --max-time 3 http://localhost:9222/json/version
```

- **Responds with JSON** → already set up correctly. Nothing to do.
- **Connection refused** → either Chrome is not running, or it is running *without* the flag. A browser that is already open cannot have the flag applied retroactively — check for a running process first:

**Windows:** `tasklist /FI "IMAGENAME eq chrome.exe"`
**Mac/Linux:** `pgrep -x "Google Chrome"` or `pgrep chrome`

If Chrome is running, **ask the user before closing it** — closing loses unsaved tabs/form data. Do not close it unilaterally.

### Launch with a dedicated debug profile

Once Chrome is closed (or was never running), launch it into an isolated profile under the project directory, so the user's normal browsing profile, history, and logins are never touched by automation:

**Windows:**
```powershell
& "$chrome" --remote-debugging-port=9222 --user-data-dir="$PWD\.automaqa\chrome-debug-profile" --no-first-run --no-default-browser-check about:blank
```

**Mac/Linux:**
```bash
"$CHROME" --remote-debugging-port=9222 --user-data-dir="$PWD/.automaqa/chrome-debug-profile" --no-first-run --no-default-browser-check about:blank &
```

Then re-verify:
```bash
curl -s --max-time 3 http://localhost:9222/json/version
```

A JSON response confirms the browser side is ready. This debug instance does not persist across reboots — the user must relaunch it (same command) at the start of any session where they need web live-verification and it is not already running. Tell them this plainly rather than letting them discover it mid-workflow.

### Keep the debug profile out of version control

`.automaqa/chrome-debug-profile` is local browser state (can grow to tens of MB) and must never be committed. Check the user's `.gitignore`:

**Windows:** `Select-String -Path .gitignore -Pattern '\.automaqa' -Quiet`
**Mac/Linux:** `grep -q '\.automaqa' .gitignore 2>/dev/null`

If no match (or `.gitignore` does not exist), append:
```
.automaqa/
```

If a `.gitignore` already exists with unrelated rules, append to it — never overwrite it.

---

## Step 12: Final Status Report

Print a clear status table:

```
Testing Environment Setup — Complete
============================================================
OS detected             : Windows / macOS / Linux
Project directory       : <user's cwd>

Component                Status       Notes
------------------------------------------------------------
Node.js                  [OK] v20.x
npm                      [OK] v10.x
npm install              [OK]         package.json deps installed
xlsx (SheetJS)           [OK]         Excel pipeline (no Python needed)
Playwright               [OK] v1.x
Playwright browsers      [OK] Chromium
playwright.config.ts     [OK]
  ↳ reporter: list       [OK]
  ↳ reporter: versioned  [OK]         ./tests/versioned-reporter.ts
  ↳ maxFailures=0, workers=1 [OK]
  ↳ globalTeardown       [OK/REMOVED] not registered (correct)
tests/versioned-reporter [OK]         copied from plugin
pages/support/healing     [OK]         copied from plugin
tests/support/flake-store [OK]         copied from plugin
tests/support/quarantine  [OK]         copied from plugin
@types/node               [OK]         needed by reporter + healing helper
Directory structure      [OK]         tests/e2e, specs, maestro/flows
Maestro CLI              [OK/SKIP/FAIL]
Java (Maestro dep)       [OK/SKIP]    Windows only
Maestro MCP plugin       [OK/SKIP]    registered via claude mcp add --scope user
Maestro MCP connection   [OK/WARN]    WARN if session restart needed
Chrome DevTools MCP plugin [OK/SKIP]  installed via claude plugin install
Chrome DevTools MCP conn.  [OK/WARN]  WARN if session restart needed
Chrome remote debugging  [OK/WARN]    localhost:9222 responding
============================================================

Status: READY  (or list of items needing attention)

Next steps:
  Import cases     →  /automaqa:import-cases  (xlsx, csv, json, md, feature, yaml, xml, txt)
  Test health      →  /automaqa:flake-guard   (once a few runs have accumulated)
  Web testing      →  /automaqa:playwright-e2e
  Mobile testing   →  /automaqa:maestro-e2e
```

For any WARN or FAIL, print a one-line fix directly below the table.

**If Step 8 registered the Maestro MCP and/or Step 10 installed the Chrome DevTools MCP plugin during this run**, end with one single, unmissable prompt — do not bury it in the table:

> ⚠️ **Restart Claude Code now** (fully quit and reopen — not just close the window) so the newly installed MCP plugin(s) load. Then re-run `/automaqa:setup` once to confirm both show `[OK]`, or just start using `/automaqa:playwright-e2e` / `/automaqa:maestro-e2e` directly.

---

## Step-skip Reference

| SETUP_SCOPE | Steps to skip |
|---|---|
| `web` | Steps 7, 8, 9 (Maestro CLI install, Maestro MCP plugin install, Maestro MCP verify) |
| `mobile` | Steps 1, 2, 3, 4, 5, 6, 10, 11 (Node, npm, Playwright, dirs, reporter, xlsx, Chrome DevTools MCP plugin install, Chrome remote-debugging prep) |
| `both` | Run all steps |

---

## Strict Rules

1. Never assume anything is installed — always check with a version command first.
2. Never overwrite `playwright.config.ts` — read it first and apply targeted edits only.
3. Always run Step 12 (final status) even if most steps were skipped.
4. Show both Windows and Mac/Linux commands for every step — run only the one matching the detected OS.
5. Python is **not required**. The pipeline is fully Node.js. Never ask the user to install Python.
6. **Never add `globalTeardown` to `playwright.config.ts`.** It is a no-op in this project. Reports are generated by `tests/versioned-reporter.ts` registered as a custom reporter.
7. **Never add the `json` reporter to `playwright.config.ts`.** The versioned-reporter generates HTML directly from in-memory data — no intermediate JSON file is needed.
8. `test-results/` directory is **not created** and **not needed** — the versioned-reporter does not write to it.
9. **Never assume a plugin's presence in the cache means it is loaded.** A cached-but-not-enabled plugin and a genuinely missing one look identical from a tool-availability check — always distinguish "not registered/installed" from "installed but this session needs a restart" before telling the user what to do.
10. **Never close the user's browser, terminate a running process, or overwrite an existing `.gitignore`/config file without asking first**, even when doing so would fix the immediate problem.
