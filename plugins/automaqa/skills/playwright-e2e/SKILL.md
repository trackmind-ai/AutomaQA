---
description: Universal autonomous workflow for writing and verifying E2E Playwright tests using visual discovery. Master orchestrator for web and mobile testing.
when_to_use: Use when the user wants to run E2E tests, write Playwright tests, test a web feature, verify a spec against a live app, or start the full testing workflow. Trigger on phrases like "run tests", "write playwright tests", "test this feature", "start e2e", "run the spec".
argument-hint: [spec-path or feature-name]
---

# Universal Playwright E2E Workflow — Master Orchestrator

This is the entry point for **web** and **web + mobile** E2E testing. Follow every step in order. Do not write any test code before completing the live verification phase.

---

## Skill Invocation Map

| Sub-Skill | When to Invoke |
|---|---|
| `automaqa:page-objects` | Step 8 — BEFORE writing any test code, to build the page objects |
| `automaqa:self-healing` | Step 8 — when a locator needs ranked fallback candidates |
| `automaqa:playwright-skill` | Step 8 — when writing Playwright TypeScript code |
| `automaqa:flake-guard` | Step 9 — when a test passes only on retry, or fails intermittently |
| `automaqa:maestro-e2e` | Step 5 — for mobile-scoped steps (web + mobile mode only) |
| `automaqa:maestro-skill` | Invoked automatically inside maestro-e2e during YAML authoring |
| `automaqa:setup` | Before Step 3 — if `playwright.config.ts`, `tests/versioned-reporter.ts`, or `tests/e2e/` do not exist in the user's project |
| `automaqa:import-cases` | Before this skill, if spec.md does not yet exist |

---

## Step 0: Confirm Testing Mode

First confirm the platform. If the user's message already makes it clear (e.g. "run web tests", "playwright only"), skip this and proceed.

Otherwise ask:

> This skill runs **web E2E tests** (Playwright in Chrome), with optional mobile parity.
>
> What do you want to test?
> - **Web only** — browser tests, no device needed
> - **Web + mobile** — browser tests plus Maestro runs for mobile-scoped steps
> - **Mobile only** — if you only need mobile, use `/automaqa:maestro-e2e` instead

If the user says mobile only — stop here and tell them to run `/automaqa:maestro-e2e`. Do not continue.

Store the answer as `TEST_MODE` (`web` or `both`) for use in Step 5.

---

## Step 1: Collect Test Credentials

Ask the user for the credentials needed for this test run. Do not assume defaults. Do not look for a `.env` file.

> To run these tests I need a few details. Please provide:
> 1. **Base URL** — the root URL of the app (e.g. `https://staging.myapp.com`)
> 2. **Test email** — the login email for the test account
> 3. **Password** — the password for the test account
> 4. **Additional roles** — e.g. admin email/password if the spec has multi-role flows

Wait for the user's reply. Store as named variables:
- `BASE_URL`
- `TEST_EMAIL`
- `TEST_PASSWORD`
- Any additional role credentials

These are used directly throughout this session — passed as inline constants, never written to a file.

---

## Step 2: Read Specs and Derive the Test Plan

**Pre-flight check:** Verify `specs/<feature>/spec.md` exists in the user's cwd.
If it does not exist, stop: "No spec found. Run `/automaqa:import-cases` first, then re-run this skill."

Once the spec exists, read it and extract:

1. **Flows and journeys** — what user paths does the spec describe?
2. **Inputs and constraints** — fields, rules (type, length, required, format)
3. **Validation rules** — what the app should accept, reject, or warn about
4. **Business logic** — state changes, transitions, side effects
5. **Mobile scope** — which steps the spec marks as mobile-scoped (needed only if `TEST_MODE = both`)

From this, build the test plan:
- List every step/screen in the flow
- For each step, derive **~20 test scenarios** from the spec — positive cases + negative/adversarial cases
- Mark which steps need mobile (Maestro) validation
- **Decide structure upfront:** Are these tests independent (Pattern A) or a sequential journey (Pattern B)? See Step 8.

> The spec is the source of truth. Every test case traces back to something the spec defines.

---

## Step 3: Pre-flight Environment Check

Before doing anything in the browser, verify the user's project is correctly set up.

Check for these three things in the user's cwd:

1. **`playwright.config.ts`** — must exist and must register `./tests/versioned-reporter.ts` as a reporter (NOT globalTeardown, NOT json reporter)
2. **`tests/versioned-reporter.ts`** — must exist (copied from plugin by setup)
3. **`tests/e2e/`** — must exist (created by setup)

If any of these are missing: **stop and tell the user:**
> "Your project environment is not set up yet. Run `/automaqa:setup` first — it will create the required directories, copy the versioned reporter, and configure `playwright.config.ts` correctly. Then come back and re-run this skill."

If all three exist: continue to Step 4.

---

## Step 4: Initialize Browser via Chrome DevTools Plugin

1. Open a browser page using the Chrome DevTools plugin (`new_page`) and navigate to `BASE_URL`.
2. Capture a screenshot (`take_screenshot`) and DOM snapshot (`take_snapshot`).
3. Confirm the page loaded. Note any existing errors, layout issues, or missing elements.

> If the Chrome DevTools plugin is not responding, stop and tell the user to ensure Chrome is open with remote debugging enabled and the MCP plugin is installed, then retry.

---

## Step 5: Log In to the Application

1. Navigate to a **protected route** to trigger the auth redirect — do not rely on a landing page "Login" button (Angular/React auth guards fire immediately on protected routes):
   ```
   BASE_URL + /protected-route  (e.g. /provider/myday, /dashboard, /app/home)
   ```
2. Wait for the auth provider URL (e.g. Auth0, Okta). If using a third-party provider:
   - Wait for **any** provider URL (e.g. `/auth0\.com/`), **not** a specific path like `/login` — providers may route through `/authorize` first
3. Fill email with `TEST_EMAIL`, password with `TEST_PASSWORD`.
4. Click the submit button and wait for `networkidle` before taking a screenshot.
5. Confirm you reach the authenticated landing page.
6. If login fails, stop and report the failure — do not proceed with broken credentials.

---

## Step 6: Live Verification — Web (and Mobile if TEST_MODE = both)

For each step/screen in the flow, complete live verification before writing a single line of code:

**Web verification (always):**
1. Use Chrome DevTools tools (`click`, `fill`, `type`, `evaluate`, `take_screenshot`, `take_snapshot`, `get_network_request`, `get_console_message`) to manually interact with the live page.
2. Execute the ~20 spec-derived scenarios for this step:
   - For each rule the spec states, test both the conforming and violating case
   - For each flow the spec describes, test the straight path then attempt to break it
3. Record: what the app does correctly, where it deviates (bugs), silent failures.
4. Use `get_network_request` to validate API calls match spec expectations.
5. **After every click that triggers a server request** (login, form submit, etc.), wait for network idle before asserting the result — do not rush to the next assertion.

**Mobile verification (only if TEST_MODE = both):**
6. For steps the spec marks as mobile-scoped, invoke `automaqa:maestro-e2e` in parallel. Pass `TEST_EMAIL`, `TEST_PASSWORD`, and `BASE_URL` from Step 1.

> Execute autonomously without stopping for confirmation. Every deviation from the spec is a bug.

---

## Step 7: Create the Live Verification HTML Report (Before Writing Code)

After live verification, before writing any Playwright code:

1. Create or update `specs/<feature-slug>/report.html` — this is the **manual verification report** (no version suffix).
2. Document every scenario executed in Step 6:
   - Scenario ID, description, input used, expected (from spec), actual, status (PASS/FAIL/BUG)
   - For BUG: severity (Critical/Major/Minor), exact repro steps, screenshot path
3. Bugs from live verification go in a **Bugs Found** section at the top of the report (red, prominent).

> **Note:** The automated Playwright run produces a separate `report-v{N}.html` after each run. This is written by `tests/versioned-reporter.ts` — a custom Reporter class that collects results in `onTestEnd()` and writes the HTML in `onEnd()`. It is registered in `playwright.config.ts` and runs automatically. `report.html` (no version) is the manual live-verification record and is never overwritten.

---

## Step 8: Write Playwright Test Script

### Build the page objects first

**Invoke `automaqa:page-objects` and create or update the page objects before writing a
single test.** Tests contain behaviour; page objects contain locators. Writing the test
first inevitably embeds selectors in the spec file, and unpicking that later is a rewrite.

Use the locators captured during live verification (Step 6). For each element the spec
touches, record its role, accessible name, and test id.

Where an element is likely to churn — primary CTAs, third-party auth widgets, anything
already broken once — invoke **`automaqa:self-healing`** and give it ranked fallback
candidates. Do **not** add fallbacks to elements whose absence is the assertion
(negative tests, permission checks, empty states).

Then invoke **`automaqa:playwright-skill`** and follow its coding standards.

### Naming Convention (required)

The spec file name **must match** the `specs/` feature folder name — this is how `versioned-reporter.ts` derives the report output path:

```
tests/e2e/<feature-slug>.spec.ts  →  specs/<feature-slug>/report-v{N}.html
```

Example: `tests/e2e/login-test-cases.spec.ts` → `specs/login-test-cases/report-v1.html`

### Choose the right test structure FIRST

Before writing any test code, answer this question:

> **Are these test cases independent of each other, or does each test depend on state created by the previous one?**

| Situation | Structure to use |
|---|---|
| Tests are independent — login validation, form validation, search | **Pattern A**: `test.describe()` + `beforeEach` + `{ page }` fixture |
| Tests are a sequential journey — create → edit → delete | **Pattern B**: `test.describe.serial()` + `beforeAll` + shared `page` |

**Default to Pattern A.** Use Pattern B only when a test genuinely requires state from a previous test.

#### ⛔ NEVER use `test.describe.serial()` for independent tests

`test.describe.serial()` skips ALL remaining tests when any one test fails. For login validation, form validation, or any feature where tests don't share state, this means:
- TC_002 fails → TC_003 through TC_010 are all SKIPPED
- The user sees 9 tests "not run" even though they were completely unrelated to the failure

This is wrong. Use `test.describe()` + `beforeEach` instead — a failure in TC_002 will NEVER skip TC_003.

---

### Writing the test file

1. Create `tests/e2e/<feature-slug>.spec.ts`
2. Declare credentials as typed constants at the **top of the test file** — values from Step 1:

   ```typescript
   const BASE_URL      = 'https://staging.myapp.com';   // from user Step 1
   const TEST_EMAIL    = 'tester@example.com';           // from user Step 1
   const TEST_PASSWORD = 'password123';                  // from user Step 1
   ```

3. **Pattern A — Independent tests (default):**

   Use this for most features: login validation, form fields, search, filters, UI checks.

   ```typescript
   import { test, expect, Page } from '@playwright/test';

   const BASE_URL      = 'https://staging.myapp.com';
   const TEST_EMAIL    = 'tester@example.com';
   const TEST_PASSWORD = 'password123';

   /**
    * Navigate to the feature's starting state.
    * Clears cookies so no session leaks from a previous test or run.
    *
    * For apps with Auth0/Okta/SSO: navigate to a protected route to trigger
    * the auth redirect. Do NOT rely on a "Login" button on the landing page —
    * SPA auth guards fire immediately on protected route navigation.
    */
   async function goToStartPage(page: Page): Promise<void> {
     await page.context().clearCookies();
     await page.goto(`${BASE_URL}/protected-route`, { waitUntil: 'domcontentloaded' });
     // Wait for the auth provider URL (may route through /authorize before /login)
     await page.waitForURL(/auth/, { timeout: 20_000 });
     await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible({ timeout: 15_000 });
   }

   /**
    * Click a button that triggers a server-side auth request.
    * Always pause for network idle — Auth0/SSO processes requests asynchronously
    * and assertions will race ahead without this wait.
    */
   async function clickAndWait(page: Page, buttonName: string): Promise<void> {
     await page.getByRole('button', { name: buttonName }).click();
     await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
   }

   // test.describe() NOT serial — failures do NOT cascade to other tests
   // beforeEach NOT beforeAll — every test starts from a clean known state
   test.describe('Feature Name — validation tests', () => {

     test.beforeEach(async ({ page }) => {
       await goToStartPage(page);
     });

     test('TC_001 — valid input succeeds', async ({ page }) => {
       await page.getByLabel('Email').fill(TEST_EMAIL);
       await page.getByLabel('Password').fill(TEST_PASSWORD);
       await clickAndWait(page, 'Log In');
       // SPA may briefly land on / before routing — wait for content, not exact URL
       await page.waitForURL(/staging\.myapp\.com/, { timeout: 20_000 });
       await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });
       await expect(page).toHaveURL(/dashboard/);
     });

     test('TC_002 — invalid password shows error', async ({ page }) => {
       // TC_002 failing does NOT skip TC_003 — they are fully independent
       await page.getByLabel('Email').fill(TEST_EMAIL);
       await page.getByLabel('Password').fill('wrongpass');
       await clickAndWait(page, 'Log In');
       await expect(page.getByText('Wrong email or password.')).toBeVisible({ timeout: 10_000 });
     });

     // Each test receives { page } — its own fresh browser fixture from beforeEach
     test('TC_003 — blank email shows validation', async ({ page }) => {
       await page.getByLabel('Password').fill(TEST_PASSWORD);
       await clickAndWait(page, 'Log In');
       await expect(page.getByText('Email is required.')).toBeVisible();
     });

   });
   ```

4. **Pattern B — Sequential journey (only when tests genuinely depend on each other):**

   Use this for CRUD flows or multi-step journeys where each test builds on previous state.

   ```typescript
   import { test, expect, Page } from '@playwright/test';

   const BASE_URL      = 'https://staging.myapp.com';
   const TEST_EMAIL    = 'tester@example.com';
   const TEST_PASSWORD = 'password123';

   let page: Page;

   test.describe.serial('Appointment Flow — create → edit → delete', () => {

     test.beforeAll(async ({ browser }) => {
       // Fresh isolated context — no cookie leaks from previous runs
       const context = await browser.newContext({ storageState: undefined });
       page = await context.newPage();

       // Navigate to protected route to trigger auth redirect
       await page.goto(`${BASE_URL}/appointments`, { waitUntil: 'domcontentloaded' });
       await page.waitForURL(/auth/, { timeout: 20_000 });
       await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible({ timeout: 15_000 });

       // Login once — session shared across all tests in this block
       await page.getByLabel('Email').fill(TEST_EMAIL);
       await page.getByLabel('Password').fill(TEST_PASSWORD);
       await page.getByRole('button', { name: 'Log In' }).click();
       await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
       await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible({ timeout: 20_000 });
     });

     test.afterAll(async () => {
       // Close the whole context (not just the page) to release resources
       await page.context().close();
     });

     test('TC_001 — create appointment', async () => {
       // Individual tests in serial describe do NOT take { page }
       await page.getByRole('button', { name: 'New Appointment' }).click();
       // ...
     });

     test('TC_002 — edit the appointment from TC_001', async () => {
       // page still has TC_001's state — this is intentional for sequential flows
       await page.getByRole('button', { name: 'Edit' }).click();
       // ...
     });

   });
   ```

5. Codify all ~20 spec-derived scenarios as individual `test()` calls — positive cases first, then negative/edge cases.
6. Every scenario verified manually in Step 6 must have a corresponding automated test.
7. For mobile-scoped steps (TEST_MODE = both): embed Maestro execution inside a `test.step()` using credentials from Step 1 as inline `-e` flags.

### Auth0/SSO URL patterns

When the app uses Auth0, Okta, or any third-party auth provider:

```typescript
// ✅ Correct — matches /authorize, /login, or any provider URL
await page.waitForURL(/auth0\.com/, { timeout: 20_000 });

// ❌ Wrong — fails when provider routes through /authorize first
await page.waitForURL(/auth0\.com\/login/, { timeout: 20_000 });
```

After OAuth callback on Angular/React SPAs, wait for **content** not an exact URL — SPAs may briefly land at `/` before routing:

```typescript
// ✅ Correct — SPA may hit / before routing to /dashboard
await page.waitForURL(/your-app\.com/, { timeout: 20_000 });
await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

// ❌ Wrong — fails if Angular briefly shows / post-OAuth
await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 20_000 });
```

### Reports — automatic, versioned, invisible to test team

Reports are generated by `tests/versioned-reporter.ts` — a custom Reporter class registered in `playwright.config.ts`. The test team never touches this.

**Playwright execution order (always in this sequence):**
```
1. onBegin()      ← reporter records start time
2. onTestEnd()    ← reporter collects each test result (title, status, duration, error)
3. onEnd()        ← reporter writes specs/<slug>/report-v{N}.html  ← HTML IS WRITTEN HERE
4. globalTeardown ← runs AFTER reporters; we do nothing here
```

**Why NOT globalTeardown:**
> `globalTeardown` fires at step 4 — AFTER reporters have already run. If you try to read `results.json` inside globalTeardown the file may not exist yet (the JSON reporter writes it in its own `onEnd()`). The versioned reporter avoids this entirely by generating HTML directly from in-memory data in `onEnd()` at step 3.

**File naming:**
```
tests/e2e/<feature-slug>.spec.ts  →  specs/<feature-slug>/report-v{N}.html
```
- `tests/e2e/login-test-cases.spec.ts` → `specs/login-test-cases/report-v1.html`, `report-v2.html`, ...
- `report.html` (no version suffix) = manual live-verification report from Step 7 — **never overwritten by automation**

**The test team writes only test logic. Reports are generated automatically and invisibly.**

---

## Step 9: Run Playwright to Verify Automation

```bash
npx playwright test <path_to_test> --headed --trace on
```

1. Verify all ~20 test cases execute.
2. Confirm **no tests are skipped** — if tests are being skipped after a failure, the structure is wrong (likely `test.describe.serial()` where `test.describe()` should be used).
3. Any failures not found during manual verification are new bugs — add them to the report immediately.
4. If locator or timing issues occur: use Chrome DevTools to re-inspect the live DOM, fix, re-run.

---

## Step 10: Iterate Page-by-Page

Once the current step is fully automated:

1. Capture a screenshot and DOM snapshot of the next page/state.
2. Repeat Steps 6–9 for the next step.
3. Continue until the full journey is covered or a critical bug stops progression.

---

## Step 11: Final Report and Summary

1. Run the full test suite end-to-end:
   ```bash
   npx playwright test --headed
   # or for a specific feature:
   npx playwright test tests/e2e/<feature-slug>.spec.ts --headed
   ```

2. After the run completes, `tests/versioned-reporter.ts` (registered in `playwright.config.ts`) automatically writes:
   `specs/<feature-slug>/report-v{N}.html`

   Generation happens inside the reporter's `onEnd()` callback — at this point all test
   data is collected in memory. N is auto-incremented by counting existing `report-v*.html` files.

   The versioned HTML report contains:
   - Summary cards: total / passed / failed / skipped / total duration
   - Failure banner (red, prominent) if any tests failed
   - Table: one row per test — title, PASS/FAIL/SKIP badge, duration
   - Inline error detail row beneath every FAIL (first 400 chars of error message)

3. The live-verification HTML report (`specs/<feature-slug>/report.html`, no version suffix) remains untouched and documents manual browser verification separately.

4. Provide the report path and a structured summary in your final response.

---

## Strict Prohibitions

1. **NO CODE BEFORE VERIFICATION**: Never write Playwright code for a step before completing live Chrome DevTools verification of that step.
2. **NO MOBILE ROUTING HERE**: If the user wants mobile only, stop at Step 0 and redirect to `maestro-e2e`.
3. **NO .ENV FILES**: Credentials come from the user in Step 1 — written inline as typed constants for this session.
4. **NO GENERIC CHECKLISTS**: All test cases derive from the spec.
5. **NO HAPPY-PATH ONLY**: Every step is tested for how it breaks.
6. **NO PLACEHOLDERS**: Final scripts must be complete and runnable.
7. **NO SILENT FAILURES**: Every bug must appear in the report.
8. **HEADED BY DEFAULT**: Always run with `--headed --trace on` during development.
9. **NO SERIAL FOR INDEPENDENT TESTS**: Never use `test.describe.serial()` when tests do not depend on each other's state. Independent tests MUST use `test.describe()` + `beforeEach` so a failure in one never skips others.
10. **NO GLOBALTEARDOWN FOR REPORTS**: Never use `globalTeardown` to read `results.json` — it runs before reporters flush. Use `versioned-reporter.ts` (a custom Reporter registered in `playwright.config.ts`) instead.
11. **PAUSE AFTER AUTH ACTIONS**: After any button click that triggers a server-side auth request (login, logout, password reset), always call `page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {})` before asserting.

## Additional resources

- Playwright coding standards: [`automaqa:playwright-skill`]
- Mobile testing: [`automaqa:maestro-e2e`]
- Spec generation: [`automaqa:import-cases`]
- Environment setup: [`automaqa:setup`]
