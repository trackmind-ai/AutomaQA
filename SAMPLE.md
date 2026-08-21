# A complete walkthrough

One feature, start to finish: a bare machine, an Excel workbook from a tester, and a
passing Playwright suite with page objects, self-healing locators, and health tracking.

Every command and every output in this document is real — the extractor output and JSON
below are copied from an actual run, not written by hand.

**Contents**

1. [Before you start](#1-before-you-start)
2. [Set up the toolchain](#2-set-up-the-toolchain)
3. [Prepare the Excel file](#3-prepare-the-excel-file)
4. [Import the test cases](#4-import-the-test-cases)
5. [Review and approve the spec](#5-review-and-approve-the-spec)
6. [Live verification](#6-live-verification)
7. [Page objects](#7-page-objects)
8. [Write the tests](#8-write-the-tests)
9. [Run and read the report](#9-run-and-read-the-report)
10. [Handling a flaky test](#10-handling-a-flaky-test)
11. [Mobile with Maestro](#11-mobile-with-maestro)
12. [Day-to-day cheat sheet](#12-day-to-day-cheat-sheet)

---

## 1. Before you start

Install the plugin in Claude Code:

```
/plugin marketplace add trackmind-ai/automaqa
/plugin install automaqa@trackmind-automaqa
```

Then open a terminal in the project you want to test. AutomaQA writes into **your**
project — `tests/`, `pages/`, `specs/` — and never modifies the plugin itself.

You need Chrome DevTools MCP installed in Claude Code for web work. For mobile, you need
the Maestro MCP plus a booted emulator or simulator. Setup checks both and tells you what
is missing.

---

## 2. Set up the toolchain

```
/automaqa:setup
```

It asks whether you want web, mobile, or both, then detects your OS and installs only
what is missing. Nothing is assumed — every dependency is checked with a version command
first.

It finishes with a status table. **Read it.** This is the authoritative answer to "is my
environment ready":

```
Component                Status       Notes
------------------------------------------------------------
Node.js                  [OK] v20.x
Playwright               [OK] v1.60
Playwright browsers      [OK] Chromium
playwright.config.ts     [OK]
tests/versioned-reporter [OK]         copied from plugin
pages/support/healing    [OK]         copied from plugin
tests/support/flake-store [OK]        copied from plugin
tests/support/quarantine [OK]         copied from plugin
Maestro CLI              [OK]
Chrome DevTools MCP      [OK]
============================================================
Status: READY
```

Afterwards your project has:

```
playwright.config.ts          maxFailures: 0, workers: 1, retries: CI ? 1 : 0
tests/e2e/                    specs go here — behaviour only, no locators
tests/support/                flake-store.ts, quarantine.ts
tests/versioned-reporter.ts   writes specs/<feature>/report-v{N}.html
pages/                        page objects — the ONLY place web locators live
pages/support/                healing-locator.ts
screens/                      mobile screen objects
specs/                        spec.md files and HTML reports
maestro/flows/                Maestro YAML
```

> **If setup just registered the Maestro MCP, restart Claude Code.** MCP servers load at
> startup, so it will not be reachable until you do.

Setup is idempotent — re-run it any time to repair an environment. It never overwrites
`playwright.config.ts`; it applies targeted edits.

---

## 3. Prepare the Excel file

This is the part testers usually ask about, so here is exactly what works.

### What a good sheet looks like

| TC ID | Test Type | Test Scenario | Pre-Condition | Test Data | Test Steps | Expected Result | Status | Tester |
|---|---|---|---|---|---|---|---|---|
| TC_LOGIN_001 | Functional Positive | Valid credentials redirect to My Day | Registered active user exists | user@example.com / Correct1! | 1. Open /login<br>2. Enter email<br>3. Enter password<br>4. Click Sign in | User lands on My Day page and sees heading "My Day" | Pass | asha |
| TC_LOGIN_002 | Functional Negative | Invalid password shows error | Registered active user exists | user@example.com / WrongPass | 1. Open /login<br>2. Enter wrong password<br>3. Click Sign in | Error message "Invalid credentials" is shown | Pass | asha |
| TC_LOGIN_003 | Functional Negative | Blank email shows required validation | | (empty) | 1. Open /login<br>2. Leave email blank<br>3. Click Sign in | Validation message "Email is required" appears | Fail | ravi |

### Rules that actually matter

**One sheet per feature.** Sheet names become feature names, so `Login` and `Cart` produce
`specs/login/spec.md` and `specs/cart/spec.md`. Do not put two features on one sheet.

**Column names are flexible.** These all map correctly, so you do not need to rename
anything from your existing template:

| Field | Any of these headers work |
|---|---|
| ID | TC ID, Test ID, Case ID, Key, Sr No |
| Type | Test Type, Scenario Type, Category, Priority, Severity |
| Scenario | Test Scenario, Test Case, Title, Summary, Description |
| Pre-condition | Pre-Condition, Preconditions, Prerequisites, Setup |
| Test data | Test Data, Data, Input, Parameters |
| Steps | Test Steps, Steps, Action, Test Procedure |
| Expected | Expected Result, Expected, Acceptance Criteria |

**A title row above the table is fine.** Rows are scored and the real header is found, so
`"Login Module — Regression Suite v3"` at the top does not break anything.

**`Status`, `Actual Result`, `Comments` and `Tester` are ignored on purpose.** They record
a *past run*, not the specification. Importing them would bake last month's result into the
spec — so a test could end up asserting that a known bug is the expected behaviour.

**Quote the exact UI text in Expected Result.** Write `Error message "Invalid credentials"
is shown`, not `an error appears`. Those quoted strings become the assertions. Vague
expectations produce vague tests.

**Put each step on its own line** inside the cell (Alt+Enter in Excel). Numbered lines are
ideal.

### What breaks it

| Problem | Why | Fix |
|---|---|---|
| Merged cells | One row can no longer be read as one case | Unmerge before exporting |
| Two features on one sheet | Everything lands in one spec | Split into sheets |
| Empty Expected Result | Nothing to assert | Fill it in, or delete the row |
| Vague expectations | Produces vague tests | Quote the real UI text |
| Screenshots instead of text | Not readable as data | Describe the expectation in words |

### Not using Excel?

Any of these work identically — same command, format auto-detected:

`.csv` `.tsv` · `.json` (including Zephyr / TestRail / Xray exports) · `.md` (tables or
prose) · `.feature` (Gherkin) · `.yaml` · `.xml` · `.txt`

See [docs/intake.md](docs/intake.md). Writing cases by hand is often nicest in Markdown or
YAML.

---

## 4. Import the test cases

```
/automaqa:import-cases ./Login_Test_Cases.xlsx
```

Claude asks for environment details first — base URL, credentials, account state. Answer,
or say `skip` to leave placeholders.

Then it runs the extractor. This is the **real output** from the workbook above:

```
[INFO] parsing as xlsx
[INFO] 'Login': header found on row 3; 2 row(s) above it ignored
[INFO] Column 'Status' is not a recognised field — ignored
[INFO] Column 'Tester' is not a recognised field — ignored
[INFO] extracted 7 case(s) across 2 feature(s)
Extracted 7 test case(s) in 2 feature(s) from xlsx -> specs/raw_test_cases.json
```

Each case becomes exactly this shape, regardless of the source format:

```json
{
  "id": "TC_LOGIN_001",
  "type": "Functional Positive",
  "scenario": "Valid credentials redirect to My Day",
  "precondition": "Registered active user exists",
  "test_data": "user@example.com / Correct1!",
  "steps": "1. Open /login\n2. Enter email\n3. Enter password\n4. Click Sign in",
  "expected": "User lands on My Day page and sees heading \"My Day\""
}
```

### ⚠ Reconcile the count — this is the one step never to skip

The importer reports how many cases it found. **Compare it against your workbook.**

If your sheet has 40 rows and the importer found 37, stop and find out why *before*
generating specs. Silently importing 37 makes three cases look tested when they were never
imported at all — the worst failure mode in test intake, because it is invisible.

| Symptom | Likely cause | Fix |
|---|---|---|
| Far too few cases | Wrong header row, or wrong delimiter in a CSV | Check the `--verbose` header line; force `--format=` |
| One case per sheet | Merged cells | Unmerge and re-export |
| Empty scenarios | No recognised title column | Confirm which column holds the case name |
| Extra junk cases | Trailing notes rows below the table | Confirm, then ignore |

---

## 5. Review and approve the spec

Claude writes `specs/login/spec.md` and shows it to you. It follows a fixed nine-section
format — Environment, Feature Overview, Entity States, Field Contracts, UI Reference, Data
Prerequisites, Happy Path, Test Cases, Acceptance Criteria:

```markdown
# Login — Test Spec

## Environment

| Key | Value |
|---|---|
| Base URL | https://app.example.com |
| Login email | user@example.com |

## UI Reference

| Element | Exact Label / Text |
|---|---|
| Submit button | "Sign in" |
| Error banner | "Invalid credentials" |
| Email validation | "Email is required" |

## Test Cases

### Functional Positive

| ID | Description | Steps | Test Data | Expected Result |
|---|---|---|---|---|
| TC_LOGIN_001 | Valid credentials redirect to My Day | 1. Open /login … | user@example.com / Correct1! | User lands on My Day page … |
```

**This is the cheapest place to catch a misunderstanding.** Read the UI Reference section
especially — those strings become your assertions. Ask for changes and it loops until you
approve.

Nothing is automated until you explicitly approve. Then the testing skill starts
immediately.

---

## 6. Live verification

Before any test code exists, AutomaQA drives the real app through the spec using Chrome
DevTools MCP: navigates, logs in, interacts, reads the DOM and console.

Two things come out of this:

1. **Verified locators.** Every selector used later was *observed on a real screen*, not
   guessed from the spec.
2. **A findings report** at `specs/login/report.html`, written *before* test code.

That ordering is deliberate. If verification finds a genuine bug, it gets recorded as a
bug. Writing tests first tends to encode broken behaviour as the expected result.

> If Chrome DevTools MCP is not responding, Chrome needs remote debugging on port 9222.
> See [docs/setup.md](docs/setup.md#chrome-remote-debugging).

---

## 7. Page objects

Now the locators get a home. One rule:

> **A locator string appears exactly once in the entire repository.**

```ts
// pages/login.page.ts
import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';
import { heal, type Candidate } from './support/healing-locator';

export class LoginPage extends BasePage {
  readonly path = '/login';

  // Private: a public locator invites mechanics back into the spec file.
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly errorBanner: Locator;

  // The submit button is a primary CTA and churns, so it gets ranked fallbacks.
  private readonly submitCandidates: Candidate[] = [
    { label: 'testid=login-submit', find: p => p.getByTestId('login-submit') },
    { label: 'role=button "Sign in"', find: p => p.getByRole('button', { name: 'Sign in' }) },
    { label: 'role=button /log ?in/i', find: p => p.getByRole('button', { name: /log ?in/i }) },
  ];

  constructor(page: Page) {
    super(page);
    this.emailInput    = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.errorBanner   = page.getByRole('alert');
  }

  async open(): Promise<void> {
    await this.page.goto(this.path);
    await this.waitUntilReady();
  }

  async waitUntilReady(): Promise<void> {
    await expect(this.emailInput).toBeVisible();
  }

  /** Fills and submits. Does NOT assert the outcome — the test does that. */
  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    const submit = await heal(this.page, 'Login submit button', this.submitCandidates);
    await submit.click();
  }

  async errorMessage(): Promise<string> {
    await expect(this.errorBanner).toBeVisible();
    return (await this.errorBanner.textContent())?.trim() ?? '';
  }

  /** Navigation returns the NEXT page object, so a wrong sequence fails to compile. */
  async signInExpectingSuccess(email: string, password: string): Promise<DashboardPage> {
    await this.signIn(email, password);
    const dashboard = new DashboardPage(this.page);
    await dashboard.waitUntilReady();
    return dashboard;
  }
}
```

And the page it navigates to:

```ts
// pages/dashboard.page.ts
import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class DashboardPage extends BasePage {
  private readonly pageHeading: Locator;

  constructor(page: Page) {
    super(page);
    this.pageHeading = page.getByRole('heading', { name: 'My Day' });
  }

  async waitUntilReady(): Promise<void> {
    await expect(this.pageHeading).toBeVisible();
  }

  /** Exposed for the test to assert on — a narrow getter, not the raw locator set. */
  heading(): Locator {
    return this.pageHeading;
  }
}
```

Key points:

- **Locators are private.** Expose methods, not locators.
- **Page objects never assert business outcomes** — only *readiness* (has it loaded).
  Asserting inside `signIn()` would hide which test actually cares.
- **Fallbacks only where churn is likely.** Not on every element — that doubles the file
  for no benefit.
- **Never add fallbacks to negative assertions.** See section 10.

---

## 8. Write the tests

The spec file now reads like the spec it came from — no selectors at all:

```ts
// tests/e2e/login.spec.ts
import { test, expect } from '../support/quarantine';   // NOT @playwright/test
import { LoginPage } from '../../pages/login.page';

test.describe('Login', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.open();
  });

  test('TC_LOGIN_001 — valid credentials redirect to My Day', async () => {
    const dashboard = await loginPage.signInExpectingSuccess('user@example.com', 'Correct1!');
    await expect(dashboard.heading()).toHaveText('My Day');
  });

  test('TC_LOGIN_002 — invalid password shows error', async () => {
    await loginPage.signIn('user@example.com', 'WrongPass');
    expect(await loginPage.errorMessage()).toBe('Invalid credentials');
  });

  test('TC_LOGIN_003 — blank email shows required validation', async () => {
    await loginPage.signIn('', 'Correct1!');
    expect(await loginPage.errorMessage()).toBe('Email is required');
  });
});
```

Three things to notice:

**Test titles carry the TC ID.** That is your traceability back to the spec and the
workbook.

**Import from `../support/quarantine`, not `@playwright/test`.** That is what makes
quarantine work.

**`test.describe()`, not `test.describe.serial()`.** These tests are independent. In serial
mode one failure skips every test after it, so an unrelated break hides the real state of
the suite. Only use `.serial()` for a genuine sequential journey (create → edit → delete).

Notice there is **not a single locator** in this file — not even for the dashboard heading.
`signInExpectingSuccess()` returns a `DashboardPage`, and `heading()` is a narrow getter on
it. Verify the boundary holds at any time:

```bash
grep -rn "getByRole\|getByLabel\|getByTestId\|locator(" tests/
```

Any output is a locator that belongs in a page object.

The file name must match the spec folder — `tests/e2e/login.spec.ts` →
`specs/login/report-v{N}.html`.

---

## 9. Run and read the report

```bash
npx playwright test                          # all, headed
npx playwright test tests/e2e/login.spec.ts  # one feature
```

You get `specs/login/report-v1.html`, then `-v2`, and so on. Nothing is overwritten, so
runs stay comparable.

The console prints a health summary:

```
📊 Report written → specs/login/report-v1.html

Test health
────────────────────────────────────────────────────────────
tracked: 5   flake rate: 0.0%
```

Once things start drifting you will see sections like:

```
Flaked in this run (passed only after a retry):
  tests/e2e/login.spec.ts :: TC_LOGIN_002 — invalid password shows error
    passed only after 1 retry(ies) this run

Consistently failing — real bugs, NOT quarantined:
  tests/e2e/login.spec.ts :: TC_LOGIN_003 — blank email shows required validation
    failed 8/8 runs — broken, not flaky
```

Act by section:

| Section | Action |
|---|---|
| Flaked in this run | Investigate now — the cause is fresh |
| Unreliable over time | Quarantined automatically; work the queue |
| Consistently failing | **Fix the bug or the test.** Never quarantine. |
| Currently quarantined | Debt — work it down |

If a heal was used you also get:

```
[HEAL] "Login submit button" — primary "testid=login-submit" failed;
       used fallback #2 "role=button \"Sign in\"". Update the page object.
```

The test passed, but the primary locator is stale. Fix it before the fallback drifts too.

---

## 10. Handling a flaky test

Say `TC_LOGIN_002` starts passing and failing without any code change.

**Run 1–4:** history accumulates. Nothing is judged yet — fewer than 5 samples.

**Run 5:** pass rate is 40% over 5 runs, so it is quarantined automatically:

```
[QUARANTINED] tests/e2e/login.spec.ts :: TC_LOGIN_002 — pass rate 40% over 5 runs
```

It is now skipped by default and no longer blocks CI, but stays visible in the report with
its pass rate. Then:

```bash
AUTOMAQA_QUARANTINE=only npx playwright test    # work on just the quarantined set
AUTOMAQA_QUARANTINE=off  npx playwright test    # check if it passes now
```

Fix the cause, then let green runs accumulate. At a 95% pass rate it is **released
automatically** — nobody has to remember:

```
[RELEASED] tests/e2e/login.spec.ts :: TC_LOGIN_002 — pass rate recovered to 95%
```

### The rule that matters most

> **A test failing *intermittently* is flaky. A test failing *every time* is broken.
> Quarantine the first. Never the second.**

A test at 0% pass rate is **never** quarantined — it keeps failing, so the real bug keeps
breaking the build. Quarantining it would hide a bug behind a green build, which is worse
than the flake you were fixing, because now nobody is looking.

### Common flake causes, in order

1. **`waitForTimeout()` instead of waiting for state** — by far the most common. Use
   `await expect(locator).toBeVisible()`.
2. **Test interdependence.** If it passes alone but fails in the suite, it depends on
   another test's data. Generate unique data per test.
3. **Racing the network or an animation.** Wait for the settled state.
4. **Non-unique locators.** Two matches resolve unpredictably.
5. **A genuine product race condition.** The test is right and the app is flaky — **file
   the bug, do not quarantine.**

> Before quarantining, ask: *is the test unreliable, or the product?*

Never raise `retries` to force a suite green. Retries are a measurement instrument; each
one roughly squares the chance a broken test slips through.

Full detail: [docs/test-health.md](docs/test-health.md).

---

## 11. Mobile with Maestro

Same spec, same flow, different driver:

```
/automaqa:maestro-e2e
```

Boot an emulator or simulator first — `list_devices` returning empty means nothing is
running.

Screens get objects too. One element id, one file:

```yaml
# screens/login.screen.yaml
# Screen object: Login. Inputs: EMAIL, PASSWORD.
appId: ${APP_ID}
---
- assertVisible: "Sign in"        # readiness check
- tapOn:
    id: "email_input"
- inputText: ${EMAIL}
- tapOn:
    id: "password_input"
- inputText: ${PASSWORD}
- tapOn: "Sign in"
```

The flow composes screens and holds the assertions:

```yaml
# maestro/flows/login.yaml
appId: com.example.app
---
- launchApp:
    clearState: true
- runFlow:
    file: ../../screens/login.screen.yaml
    env:
      EMAIL: user@example.com
      PASSWORD: Correct1!
- assertVisible: "My Day"          # assertion lives here, not in the screen
```

```bash
maestro test maestro/flows/login.yaml
```

Maestro cannot detect ambiguity, so prefer `id` over text and treat text fallbacks as
strictly temporary.

---

## 12. Day-to-day cheat sheet

```bash
# Setup / repair
/automaqa:setup                     # or: web | mobile | both

# Import cases (any format)
/automaqa:import-cases ./Cases.xlsx
/automaqa:import-cases ./cases.csv
/automaqa:import-cases ./login.feature

# Author and run
/automaqa:playwright-e2e            # web
/automaqa:maestro-e2e               # mobile

# Guidance skills
/automaqa:page-objects              # where does this locator go?
/automaqa:self-healing              # add fallbacks safely
/automaqa:flake-guard               # this test is flaky

# Run tests
npx playwright test
npx playwright test tests/e2e/login.spec.ts
npx playwright test -g "TC_LOGIN_002"

# Quarantine
AUTOMAQA_QUARANTINE=only npx playwright test
AUTOMAQA_QUARANTINE=off  npx playwright test

# Is a locator leaking into a spec file?
grep -rn "getByRole\|getByLabel\|getByTestId\|locator(" tests/
```

### Seven rules that keep a suite alive

1. **Reconcile the imported case count** against the source before generating specs.
2. **Never put a locator in a test file.** Page objects only.
3. **Never assert business outcomes inside a page object.** Readiness only.
4. **Never `waitForTimeout()`** as synchronisation.
5. **Never quarantine a consistently-failing test**, and never raise `retries` to go green.
6. **Never heal a negative assertion** — absence is the thing being verified.
7. **Read the flake rate every run.** An unmeasured suite is an untrusted one.

### Where to go next

| Topic | Doc |
|---|---|
| Prerequisites, MCP setup, Chrome debugging | [docs/setup.md](docs/setup.md) |
| The four-stage pipeline in depth | [docs/workflow.md](docs/workflow.md) |
| Page objects, self-healing, coding standards | [docs/authoring.md](docs/authoring.md) |
| Every supported input format and field mapping | [docs/intake.md](docs/intake.md) |
| Flake thresholds and quarantine policy | [docs/test-health.md](docs/test-health.md) |
| Something is broken | [docs/troubleshooting.md](docs/troubleshooting.md) |
