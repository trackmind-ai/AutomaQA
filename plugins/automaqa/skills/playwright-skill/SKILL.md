---
description: Playwright TypeScript coding standards for writing robust, maintainable E2E test scripts. Invoked by automaqa:playwright-e2e at Step 7.
when_to_use: Use when writing Playwright test code, generating TypeScript test files, choosing locators, or structuring test cases. Do not invoke standalone — always have spec-derived scenarios ready first.
disable-model-invocation: true
---

# Playwright Script Writing Standards

> This skill is a coding reference. It is invoked by `automaqa:playwright-e2e` at Step 7 — not triggered directly by the user. Always have spec-derived test scenarios ready before writing code.

Technical rules for writing robust, fully automated Playwright tests.

---

## Coding Rules

### 1. Robust Web-First Locators

Always use user-facing accessible locators:

- Role-based: `page.getByRole(role, { name })`
- Content-based: `page.getByLabel()`, `page.getByPlaceholder()`, `page.getByText()`
- Avoid brittle CSS paths, class names, or deep DOM hierarchies.

### 2. Auto-Retrying Assertions

Always use asynchronous, auto-retrying assertions:

- `await expect(locator).toBeVisible()`
- `await expect(locator).toHaveText('...')`
- Never use manual boolean flags or hardcoded timeouts.

### 3. Smart Waiting

Rely on Playwright's built-in auto-waiting:

- Page transitions: `await page.waitForURL(/pattern/)`
- After form submissions or button clicks that trigger async server requests, always wait for network to settle before asserting:
  ```typescript
  await page.getByRole('button', { name: 'Submit' }).click();
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
  ```
- Avoid `page.waitForTimeout()` — use `waitForLoadState` or `waitForURL` instead.

### 4. Self-Contained and Dynamic Data

- Generate dynamic values (emails with timestamps, random IDs) to avoid duplicate key errors across runs.
- Credentials and base URL are collected from the user before testing begins (by `automaqa:playwright-e2e` Step 1) and declared as typed constants at the top of the test file — **never read from process.env or a .env file**.

### 5. Screenshots at Every Major Action and Failure

- Capture programmatic screenshots at every major action, page transition, and before/after any wait.
- Configure automatic capture on failure in `playwright.config.ts`: `screenshot: 'on'`, `trace: 'retain-on-failure'`.
- Use try-catch screenshot helpers for experimental or dynamic steps.

---

### 6. Test Structure — Independent Tests vs Sequential Flows

**Choose the right structure based on whether tests are independent or sequential:**

---

#### Pattern A — Independent Tests (default for most features)

Use when: each test case can run on its own without relying on state from a previous test.
Examples: login validation, form validation, search, filters, modal dialogs.

**Rules:**
- Use `test.describe()` (NOT `test.describe.serial()`)
- Use `beforeEach` — each test gets its own fresh page and clean state
- Every `test()` receives `{ page }` as a fixture parameter
- A failure in one test **never skips** any other test
- Tests can run in any order without breaking

```typescript
import { test, expect } from '@playwright/test';

const BASE_URL      = 'https://staging.app.com';
const TEST_EMAIL    = 'tester@example.com';
const TEST_PASSWORD = 'password123';

/**
 * Navigate to the login form (or any required starting page).
 * Clears cookies so no session leaks from a previous test.
 */
async function goToStartPage(page: ReturnType<typeof test.extend>): Promise<void> {
  await page.context().clearCookies();
  await page.goto(`${BASE_URL}/protected-route`, { waitUntil: 'domcontentloaded' });
  // Wait for the starting state (e.g. login form, dashboard, modal)
  await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible({ timeout: 15_000 });
}

test.describe('Feature Name — validation tests', () => {

  test.beforeEach(async ({ page }) => {
    await goToStartPage(page);
  });

  test('TC_001 — valid input succeeds', async ({ page }) => {
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 15_000 });
  });

  test('TC_002 — blank fields show validation', async ({ page }) => {
    await page.getByRole('button', { name: 'Log In' }).click();
    await expect(page.getByText('Email is required.')).toBeVisible();
    await expect(page.getByText('Password is required.')).toBeVisible();
  });

  // Each test is fully independent — a failure here does not skip TC_004
  test('TC_003 — invalid email format rejected', async ({ page }) => {
    await page.getByLabel('Email').fill('notanemail');
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await expect(page.getByText('Please enter a valid email address.')).toBeVisible();
  });

});
```

---

#### Pattern B — Sequential Flow (multi-step journeys only)

Use when: tests represent stages of a journey where each step builds on the previous one.
Examples: "create appointment → edit appointment → delete appointment", "onboard client → assign program → review".

**Rules:**
- Use `test.describe.serial()` — tests MUST run in order
- Use `beforeAll` with a shared `page` — login once, browser stays open
- Individual `test()` calls do NOT take `{ page }` — they use the outer shared `page`
- `afterAll` closes the context after all tests complete

```typescript
import { test, expect, Page } from '@playwright/test';

const BASE_URL      = 'https://staging.app.com';
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

    // Login once — session is shared across all tests in this block
    await page.getByLabel('Email').fill(TEST_EMAIL);
    await page.getByLabel('Password').fill(TEST_PASSWORD);
    await page.getByRole('button', { name: 'Log In' }).click();
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    await expect(page.getByRole('heading', { name: 'Appointments' })).toBeVisible({ timeout: 20_000 });
  });

  test.afterAll(async () => {
    // Close the whole context (not just the page) to release all resources
    await page.context().close();
  });

  test('TC_001 — create appointment', async () => {
    await page.getByRole('button', { name: 'New Appointment' }).click();
    // ... steps
  });

  test('TC_002 — edit the appointment created in TC_001', async () => {
    // page is still on the appointments page with TC_001's data
    await page.getByRole('button', { name: 'Edit' }).click();
    // ... steps
  });

  test('TC_003 — delete the edited appointment', async () => {
    await page.getByRole('button', { name: 'Delete' }).click();
    // ... steps
  });

});
```

---

#### Decision Guide

| Question | Answer → Pattern |
|---|---|
| Can each test run independently? | Yes → Pattern A (`describe` + `beforeEach`) |
| Does TC_002 depend on state created by TC_001? | Yes → Pattern B (`describe.serial` + `beforeAll`) |
| Is this a login/validation/form feature? | Almost always Pattern A |
| Is this a CRUD flow or multi-step journey? | Pattern B |
| Should a failure in one test skip the rest? | No → Pattern A |

**When in doubt, use Pattern A.** It is safer, more isolated, and more maintainable.

---

### 7. Handling Third-Party Auth Providers (Auth0, Okta, etc.)

When the app uses an external auth provider (Auth0, Okta, Firebase Auth, etc.):

1. **Navigate to a protected route** to trigger the auth redirect — do not rely on clicking a "Login" button on the landing page (it can race with Angular/React routing):
   ```typescript
   await page.goto(`${BASE_URL}/protected-route`, { waitUntil: 'domcontentloaded' });
   ```

2. **Wait for ANY provider URL**, not a specific path — providers may route through `/authorize` before `/login`:
   ```typescript
   // ✅ Correct — matches /authorize, /login, or any provider path
   await page.waitForURL(/auth0\.com/, { timeout: 20_000 });

   // ❌ Wrong — fails when provider routes through /authorize first
   await page.waitForURL(/auth0\.com\/login/, { timeout: 20_000 });
   ```

3. **Confirm the login form is rendered** by waiting for the heading, not just the URL:
   ```typescript
   await expect(page.getByRole('heading', { name: 'Login' })).toBeVisible({ timeout: 15_000 });
   ```

4. **After login, wait for the heading** — not an exact URL — because SPAs may briefly land on `/` before the router navigates to the final route:
   ```typescript
   // ✅ Correct — waits for the page content to confirm navigation is complete
   await page.waitForURL(/your-app\.com/, { timeout: 20_000 });
   await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible({ timeout: 20_000 });

   // ❌ Wrong — fails if Angular briefly hits / before /dashboard
   await page.waitForURL(`${BASE_URL}/dashboard`, { timeout: 20_000 });
   ```

5. **Clear cookies before each test** to prevent session leaks across runs:
   ```typescript
   await page.context().clearCookies();
   ```

---

### 8. Pause After Auth Actions

After any button click that triggers a server-side authentication request (login, logout, password reset), always pause for network idle before asserting the result:

```typescript
/**
 * Wraps a button click with a network-idle pause.
 * Prevents assertions from racing ahead of Auth0's async response.
 */
async function clickAndWait(page: Page, buttonName: string): Promise<void> {
  await page.getByRole('button', { name: buttonName }).click();
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
}

// Usage:
await clickAndWait(page, 'Log In');
await expect(page.getByText('Wrong email or password.')).toBeVisible({ timeout: 10_000 });
```

---

## Testing Strategy

### Spec-Derived Test Case Generation (~20 Cases Per Step)

All test scenarios must be derived from the spec. Read what the spec defines for the current step — its inputs, validation rules, state transitions, and expected behaviors — then generate ~20 test cases covering:

**Positive cases (20-30% of scenarios):**
- The exact happy path the spec describes
- Valid boundary values the spec defines as acceptable

**Negative and adversarial cases (70-80% of scenarios):**
- Inputs that violate each validation rule the spec defines (submit what should be rejected)
- Missing required fields the spec marks as mandatory
- Values at and just beyond the boundaries the spec sets
- Wrong data types for fields the spec types (e.g., text where a number is required per spec)
- Invalid formats for fields the spec formats (e.g., bad email where spec requires email)
- Skipping steps that the spec requires to occur in order
- Attempting state transitions the spec says should not be possible
- Submitting the same valid data twice where the spec implies uniqueness
- Rapid double-submissions and concurrent actions on spec-described flows
- Navigating backward mid-flow then re-submitting

> Every scenario maps to something the spec defines. If a case cannot be traced to the spec, it does not belong.

### Code Generation Rule

The test's data array must contain all ~20 scenarios written out explicitly. No truncation, no `// add more cases here`, no ellipses. Every scenario must be a typed-out object in the array.

---

## Test Case Structure by Component Type

### Form Fields and Inputs
- Exact valid input (spec's happy path)
- Each required field left empty while others are filled
- Values at the exact max/min length the spec defines
- Values one character beyond those limits
- Wrong type for the field
- Invalid format for the field (per spec's format rules)
- Whitespace-only input

### Grids, Tables, Search
- Empty search
- Search matching nothing in the dataset
- Search matching multiple results
- Special characters
- Whitespace-only search
- Sorting and pagination state retention

### Dialogs and Overlays
- Submit with empty inputs
- Submit with inputs that violate the spec's rules for that dialog
- Close/dismiss mid-flow and verify state is correctly reset

### Multi-Step Flows
- Use Pattern B (`describe.serial`) only when tests genuinely depend on each other
- Complete flow in correct order (spec's happy path) — first test cases cover the positive path
- Subsequent tests cover negative cases, boundary conditions, and error states

---

## Automated Reports (versioned-reporter)

After every `npx playwright test` run, `tests/versioned-reporter.ts` automatically generates a versioned HTML report. The test team never touches this file.

**Playwright execution order (always in this sequence):**
```
1. onBegin()      ← reporter records start time
2. onTestEnd()    ← reporter collects each result (title, status, duration, error)
3. onEnd()        ← reporter writes specs/<slug>/report-v{N}.html  ← HERE
4. globalTeardown ← runs AFTER reporters; no-op in this project
```

**Registration — playwright.config.ts:**
```typescript
reporter: [
  ['list'],                           // live terminal output
  ['./tests/versioned-reporter.ts'],  // generates HTML report in onEnd()
],
// NOTE: globalTeardown is NOT registered and is NOT used for reports
```

**Why NOT globalTeardown:**
> `globalTeardown` runs at step 4 — AFTER reporters. If you try to read `results.json` inside it the file may not exist yet (the JSON reporter writes it in its own `onEnd()`). The versioned reporter avoids this entirely — it generates HTML from in-memory data inside `onEnd()` at step 3, no file reading needed.

**File naming convention:**
```
tests/e2e/<feature-slug>.spec.ts  →  specs/<feature-slug>/report-v{N}.html
```

Examples:
- `tests/e2e/login-test-cases.spec.ts` → `specs/login-test-cases/report-v1.html`
- `tests/e2e/my-day-filter.spec.ts`    → `specs/my-day-filter/report-v1.html`

N is auto-incremented by counting existing `report-v*.html` files in the feature directory.

`report.html` (no version suffix) is the **manual** live-verification report — written by Step 6 of `playwright-e2e`, never overwritten by automation.

**The test team writes only test logic. Reports are generated automatically and invisibly.**

---

## Maestro Integration for Mobile Parity

When spec describes mobile behavior, embed Maestro execution inside a Playwright `test.step()`:

```typescript
import { execSync } from 'child_process';

await test.step('Mobile Parity Verification (Maestro)', async () => {
  try {
    const output = execSync(
      `maestro test -e CLIENT_EMAIL="${TEST_EMAIL}" -e CLIENT_PASSWORD="${TEST_PASSWORD}" maestro/flow.yaml`,
      { encoding: 'utf-8', stdio: 'pipe' }
    );
    suiteResults.push({ step: 'Mobile Parity', outcome: 'Passed', details: output });
  } catch (error: any) {
    suiteResults.push({ step: 'Mobile Parity', outcome: 'Failed', details: error.message });
  }
});
```

---

## Run Commands

```bash
# Run all tests headed
npx playwright test --headed

# Run a specific feature
npx playwright test tests/e2e/<feature-slug>.spec.ts --headed

# Headless (CI)
npx playwright test
```

---

## In-Browser Input Modal (When Manual Input Is Needed)

When the test needs user-provided input (OTP, email link, etc.), inject an overlay modal rather than halting:

```typescript
await page.evaluate(() => {
  const overlay = document.createElement("div");
  overlay.id = "automation-prompt-overlay";
  overlay.style.cssText = "position:fixed;top:0;left:0;width:100vw;height:100vh;background:rgba(15,15,20,0.95);z-index:999999;display:flex;justify-content:center;align-items:center;font-family:sans-serif;";
  overlay.innerHTML = `
    <div style="background:#1e1e2e;padding:24px;border-radius:8px;width:450px;text-align:center;border:1px solid #313244;">
      <h3 style="color:#cba6f7;margin-top:0;">Input Required</h3>
      <p style="color:#a6adc8;font-size:14px;">Paste the required value to continue:</p>
      <input type="text" id="prompt-input-field" style="width:100%;padding:10px;margin:15px 0;border-radius:4px;border:1px solid #45475a;background:#313244;color:#cdd6f4;" />
      <button id="prompt-submit-btn" style="background:#89b4fa;color:#11111b;border:none;padding:10px 20px;border-radius:4px;font-weight:bold;cursor:pointer;">Submit</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById("prompt-submit-btn").addEventListener("click", () => {
    const val = (document.getElementById("prompt-input-field") as HTMLInputElement).value.trim();
    if (val) overlay.setAttribute("data-user-input", val);
  });
});

const overlayLocator = page.locator("#automation-prompt-overlay");
await expect(overlayLocator).toHaveAttribute("data-user-input", /.+/, { timeout: 300000 });
const value = await overlayLocator.getAttribute("data-user-input");
await page.evaluate(() => document.getElementById("automation-prompt-overlay")?.remove());
```
