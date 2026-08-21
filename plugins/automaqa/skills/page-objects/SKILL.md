---
description: Page Object Model architecture for Playwright and Maestro — how to structure page classes, expose intent-revealing methods, and keep locators in exactly one place. Invoked by playwright-e2e and maestro-e2e before test code is written.
when_to_use: Use when creating or refactoring page objects, deciding where a locator belongs, structuring a test suite across multiple screens, or when a UI change broke many tests at once. Trigger on "page object", "POM", "page model", "refactor tests", "locators are duplicated", "one change broke every test", "screen object", "component object".
---

# Page Object Model

A Page Object is the single place that knows **how** to interact with a screen.
Tests state **what** should happen. When those two mix, a button rename becomes a
fifty-file diff.

This skill is mandatory for any suite covering more than one screen.

---

## The one rule

> **A locator string appears exactly once in the entire repository.**

Everything below follows from that. If you are about to write `getByRole(...)` in a
`.spec.ts` file, stop — it belongs in a page object.

---

## Directory layout

```
pages/                        Web page objects (Playwright)
  base.page.ts                Shared behaviour every page inherits
  login.page.ts
  dashboard.page.ts
  components/                 Reusable widgets that appear on many pages
    nav.component.ts
    data-table.component.ts
    modal.component.ts
screens/                      Mobile screen objects (Maestro subflows + a manifest)
  login.screen.yaml
  dashboard.screen.yaml
tests/e2e/                    Specs — behaviour only, zero locators
```

Create these with setup; never put page objects under `tests/`, or the boundary
erodes within a sprint.

---

## Anatomy of a page object

Four parts, in this order. Deviating makes them harder to scan.

```ts
// pages/login.page.ts
import { type Page, type Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class LoginPage extends BasePage {
  // 1 ── PATH: where this page lives
  readonly path = '/login';

  // 2 ── LOCATORS: private, the only place these selectors exist
  private readonly emailInput: Locator;
  private readonly passwordInput: Locator;
  private readonly submitButton: Locator;
  private readonly errorBanner: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput    = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton  = page.getByRole('button', { name: 'Sign in' });
    this.errorBanner   = page.getByRole('alert');
  }

  // 3 ── ACTIONS: named for user intent, never for mechanics
  async open(): Promise<void> {
    await this.page.goto(this.path);
    await expect(this.submitButton).toBeVisible();
  }

  /** Fills the form and submits. Does not assert the outcome. */
  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }

  // 4 ── QUERIES: expose state, let the test assert on it
  async errorMessage(): Promise<string> {
    await expect(this.errorBanner).toBeVisible();
    return (await this.errorBanner.textContent())?.trim() ?? '';
  }

  emailField(): Locator {
    return this.emailInput;   // for assertions the test owns
  }
}
```

### Why locators are `private`

A `public` locator invites `loginPage.emailInput.fill(...)` in a test, which puts
mechanics back in the spec. Expose a method or a narrow `Locator` getter instead.

---

## Actions vs queries

| Kind | Returns | Asserts? | Example |
|---|---|---|---|
| Action | `Promise<void>` or the next page object | Only that the action was possible | `signIn()`, `addToCart()` |
| Query | a value or a `Locator` | No | `errorMessage()`, `rowCount()` |

**A page object never asserts business expectations.** `expect(dashboard).toBeVisible()`
inside `signIn()` hides which test actually cares. Assert in the test.

The one permitted internal assertion is a *readiness* check — waiting for the page to
be interactive, as `open()` does above. That is synchronisation, not verification.

---

## Navigation returns the next page object

Model the journey in types, so a wrong sequence fails to compile:

```ts
async signInExpectingSuccess(email: string, password: string): Promise<DashboardPage> {
  await this.signIn(email, password);
  const dashboard = new DashboardPage(this.page);
  await dashboard.waitUntilReady();
  return dashboard;
}
```

Keep the plain `signIn()` too — negative tests need to stay on the login page.

---

## The base page

Put only genuinely universal behaviour here. A bloated base class is worse than none.

```ts
// pages/base.page.ts
import { type Page, type Locator, expect } from '@playwright/test';

export abstract class BasePage {
  constructor(protected readonly page: Page) {}

  /** Every page declares how to tell it has finished loading. */
  abstract waitUntilReady(): Promise<void>;

  protected async dismissToastIfPresent(): Promise<void> {
    const toast = this.page.getByRole('status');
    if (await toast.isVisible().catch(() => false)) {
      await toast.getByRole('button', { name: /close|dismiss/i }).click().catch(() => {});
    }
  }
}
```

---

## Component objects

A widget appearing on several pages gets its own class, scoped to a root locator:

```ts
// pages/components/data-table.component.ts
export class DataTable {
  constructor(private readonly root: Locator) {}

  row(text: string): Locator {
    return this.root.getByRole('row').filter({ hasText: text });
  }

  async rowCount(): Promise<number> {
    return this.root.getByRole('row').count();
  }

  async sortBy(column: string): Promise<void> {
    await this.root.getByRole('columnheader', { name: column }).click();
  }
}
```

Pages compose it:

```ts
export class ClientsPage extends BasePage {
  readonly table: DataTable;
  constructor(page: Page) {
    super(page);
    this.table = new DataTable(page.getByRole('table', { name: 'Clients' }));
  }
}
```

Scoping to a root locator is what makes the component reusable when two tables sit on
one page.

---

## What a test looks like afterwards

```ts
// tests/e2e/login.spec.ts
import { test, expect } from '@playwright/test';
import { LoginPage } from '../../pages/login.page';

test.describe('Login', () => {
  let loginPage: LoginPage;

  test.beforeEach(async ({ page }) => {
    loginPage = new LoginPage(page);
    await loginPage.open();
  });

  test('TC_002 — invalid password shows an error', async () => {
    await loginPage.signIn('user@example.com', 'wrong-password');
    expect(await loginPage.errorMessage()).toBe('Invalid credentials');
  });

  test('TC_001 — valid credentials reach the dashboard', async () => {
    const dashboard = await loginPage.signInExpectingSuccess('user@example.com', 'Correct1!');
    await expect(dashboard.heading()).toHaveText('My Day');
  });
});
```

Read it aloud: it is the spec's test case, in the spec's words. No selectors.

---

## Mobile screen objects (Maestro)

Maestro is YAML, so there are no classes — the equivalent is a **subflow per screen**
with documented inputs.

```yaml
# screens/login.screen.yaml
# Screen object: Login. Inputs: EMAIL, PASSWORD.
appId: ${APP_ID}
---
- assertVisible: "Sign in"          # readiness check
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
- launchApp
- runFlow:
    file: ../../screens/login.screen.yaml
    env:
      EMAIL: user@example.com
      PASSWORD: Correct1!
- assertVisible: "My Day"           # the assertion lives in the test
```

Same rule as the web: an element id appears in exactly one screen file.

---

## Generating page objects from live verification

Page objects are written **after** the live-verification pass, never guessed from a
spec. The workflow:

1. Live-verify the screen (Chrome DevTools MCP or Maestro `inspect_screen`).
2. Record, for each element the spec touches: its accessible role, its visible name,
   its test id if present, and any fallback.
3. Create or update the page object with those observed locators.
4. Only then write the test.

A locator that was never observed on a real screen does not go into a page object.

---

## Refactoring an existing suite

Do it incrementally; a big-bang rewrite strands the suite half-migrated.

1. Pick the screen with the most duplicated locators.
2. Create its page object with the locators already proven by passing tests.
3. Migrate one spec file. Run it. It must pass unchanged in behaviour.
4. Repeat. Delete each locator from the spec as it moves — never leave both.

Stop condition: `grep -rn "getByRole\|getByLabel\|getByTestId\|locator(" tests/`
returns nothing.

---

## Strict prohibitions

1. **No locators in `tests/`.** Not even "just this one".
2. **No assertions about business outcomes inside page objects.** Readiness checks only.
3. **No `page.waitForTimeout()` in a page object.** Wait for a condition.
4. **No test data inside page objects.** Pass it in as arguments.
5. **No cross-page knowledge.** `LoginPage` must not know the dashboard's internals;
   it returns a `DashboardPage` and stops there.
6. **No inheritance between sibling pages.** `AdminLoginPage extends LoginPage` couples
   two screens that will diverge. Compose a shared component instead.
7. **Never expose a raw `Page` from a page object.** It is a back door around the model.

---

## Additional resources

- Self-healing locator strategy: `automaqa:self-healing`
- Playwright coding standards: `automaqa:playwright-skill`
- Maestro flow standards: `automaqa:maestro-skill`
