# Writing tests

The conventions the plugin follows when it writes tests — and the ones to keep if you edit
them by hand. Full detail lives in the `page-objects`, `self-healing`,
`playwright-skill` and `maestro-skill` skills.

## Architecture in one rule

> **A locator string appears exactly once in the entire repository.**

Tests describe behaviour. Page objects know how to reach elements. When those mix, a
button rename becomes a fifty-file diff.

```
pages/                  Web page objects — the only place web locators live
  base.page.ts          Shared readiness behaviour
  login.page.ts
  components/           Reusable widgets (nav, tables, modals)
  support/              healing-locator.ts and other helpers
screens/                Mobile screen objects — the only place element ids live
tests/e2e/              Specs — behaviour only, zero locators
```

Verify the boundary holds at any time:

```bash
grep -rn "getByRole\|getByLabel\|getByTestId\|locator(" tests/
```

Any output is a locator that belongs in a page object.

### A page object at a glance

```ts
// pages/login.page.ts
export class LoginPage extends BasePage {
  private readonly emailInput: Locator;      // private: tests cannot reach in
  private readonly submitButton: Locator;

  constructor(page: Page) {
    super(page);
    this.emailInput   = page.getByLabel('Email');
    this.submitButton = page.getByRole('button', { name: 'Sign in' });
  }

  /** Actions are named for user intent, never mechanics. */
  async signIn(email: string, password: string): Promise<void> { /* ... */ }

  /** Queries expose state; the TEST does the asserting. */
  async errorMessage(): Promise<string> { /* ... */ }
}
```

Rules that matter most:

- Locators are `private`. A public locator invites mechanics back into the spec.
- Page objects never assert business outcomes — only *readiness* (has the page loaded).
  Asserting inside an action hides which test actually cares.
- Navigation returns the next page object, so a wrong sequence fails to compile.
- No test data inside page objects; pass it in.
- No inheritance between sibling pages — compose a shared component instead.

The resulting test reads like the spec it came from:

```ts
test('TC_002 — invalid password shows an error', async () => {
  await loginPage.signIn('user@example.com', 'wrong-password');
  expect(await loginPage.errorMessage()).toBe('Invalid credentials');
});
```

## Self-healing locators

High-churn elements get a ranked list of candidate locators. The first that matches
**exactly one** element wins.

```ts
const submit = await heal(this.page, 'Login submit button', [
  { label: 'testid=login-submit', find: p => p.getByTestId('login-submit') },
  { label: 'role=button "Sign in"', find: p => p.getByRole('button', { name: 'Sign in' }) },
]);
```

**Ambiguity is failure.** A candidate matching several elements is refused, never guessed
at. Guessing can make a test pass against the wrong element, which is strictly worse than
a red test because it destroys trust in the whole suite. Every fallback used is recorded
and printed, so drift shows up instead of being absorbed.

Rank candidates most-stable first: test id, then role + accessible name, then label, then
placeholder, then text. Never put a structural CSS/XPath candidate above a semantic one.

### Do not heal

Healing is wrong wherever a missing element **is** the assertion:

- Negative tests (`toBeHidden`) — never hunt for alternatives
- Permission and role checks — a lookalike could hide a security regression
- Empty and error states — absence is the expected result
- Count assertions — ambiguity is the signal, not an obstacle

Heal only when locating the element is a *precondition* of the test.

### Treat the heal report as a work queue

| Healed elements | Meaning | Action |
|---|---|---|
| 0 | Locators match reality | Nothing |
| 1–3 | Normal drift after a UI change | Update those page objects this sprint |
| 4+ | A refactor outran the suite | Re-run live verification, regenerate locators |
| Same element every run | The primary is permanently wrong | Fix it; the fallback is load-bearing |

## Playwright (web)

### Naming

```
tests/e2e/<feature-slug>.spec.ts   →   specs/<feature-slug>/report-v{N}.html
```

The slug links the test file to its report directory, so keep them matched.

### Pick the structure first

This is the decision that most affects whether a suite stays debuggable.

| Situation | Structure |
|---|---|
| Tests are independent — field validation, search, form errors | `test.describe()` + `beforeEach` + the `{ page }` fixture |
| Tests are one sequential journey — create → edit → delete | `test.describe.serial()` + `beforeAll` + a shared `page` |

**Do not use `test.describe.serial()` for independent tests.** In serial mode one failure
aborts every test after it, so a single unrelated break hides the real state of the suite.
Reach for it only when step N genuinely depends on step N-1's side effects.

### Locators

Prefer web-first, user-visible locators, most robust first:

```ts
page.getByRole('button', { name: 'Sign in' })
page.getByLabel('Email')
page.getByPlaceholder('you@example.com')
page.getByTestId('submit')
```

Avoid CSS and XPath chains tied to layout — they break on markup changes that users never
notice.

### Assertions and waiting

Use auto-retrying web-first assertions, which wait on their own:

```ts
await expect(page.getByRole('alert')).toHaveText('Email is required');
```

Never use a fixed `waitForTimeout` as a synchronization mechanism. Wait for a condition —
a URL, a visible element, a settled response.

### Fresh state

No `storageState` is configured: every test starts with a clean, cookie-free context. Tests
that need a session log in themselves. Generate unique data at run time rather than relying
on a fixture row that another test may have mutated.

### Config invariants

`playwright.config.ts` ships with these deliberately:

| Setting | Value | Why |
|---|---|---|
| `maxFailures` | `0` | Every test always runs — a failure never hides the rest |
| `retries` | `process.env.CI ? 1 : 0` | One retry in CI surfaces intra-run flakes without masking much; locally 0 keeps flakiness visible — see [test-health.md](test-health.md) |
| `workers` | `1` | Serial execution avoids concurrent auth collisions |
| `screenshot` | `'on'` | Captured for every test |
| `trace` | `'retain-on-failure'` | Trace zip only when it is useful |

### Run

```bash
npx playwright test                                   # all, headed
npx playwright test tests/e2e/<feature>.spec.ts       # one feature
npx playwright test --headed=false                    # CI
```

## Maestro (mobile)

### Inspect before authoring

Always call `list_devices`, then `inspect_screen`, before targeting an element. Write YAML
against the real view hierarchy, and re-inspect after any UI change.

### Flow shape

Mobile flows declare `appId` and start with `launchApp`; web flows declare `url` and start
with `openLink`.

```yaml
appId: com.example.app
---
- launchApp
- tapOn: "Sign in"
- inputText: "user@example.com"
- assertVisible: "My Day"
```

### Locators

Prefer visible text and accessibility ids over index-based selection. An index silently
targets the wrong element as soon as the screen's contents shift.

### Screen objects

Maestro has no classes, so the equivalent of a page object is **one subflow per screen**
under `screens/`, with its inputs documented. An element id belongs in exactly one
screen file; flows compose screens and hold the assertions.

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
- assertVisible: "My Day"      # the assertion lives in the flow, not the screen
```

Maestro cannot detect ambiguity, so on mobile prefer `id` and treat text fallbacks as
strictly temporary.

### Reuse

Factor repeated sequences — login especially — into `maestro/subflows/` and `runFlow` them.

### Run

```bash
maestro test maestro/flows/<feature>.yaml
maestro test maestro/flows/                       # whole directory
maestro test -e USERNAME=x maestro/flows/f.yaml   # with variables
maestro hierarchy                                 # inspect current screen
```

## Coverage

Aim for roughly 20 cases per screen or step, spread across positive, negative, boundary,
and state-transition cases. Field-level rules from the spec's Field Contracts section should
each produce at least one case.
