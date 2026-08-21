---
description: Self-healing locators for Playwright and Maestro — ranked fallback candidates, a confidence gate that refuses ambiguous matches, and a healing report that tells you what drifted. Invoked by playwright-e2e and maestro-e2e when authoring locators.
when_to_use: Use when tests break because selectors changed, when adding resilience to locators, when a UI refactor broke a suite, or when deciding whether a locator should have fallbacks. Trigger on "self-healing", "self healing", "flaky selector", "locator broke", "selector changed", "resilient locators", "fallback locator", "tests keep breaking on UI changes", "auto-heal".
---

# Self-Healing Locators

A self-healing locator tries a ranked list of ways to find an element, uses the first
that resolves **unambiguously**, and reports the drift so a human can fix the root cause.

## Read this before writing any healing code

Naive self-healing is dangerous. A locator that "finds something" when the intended
element is gone converts a **failing test into a passing one that verifies nothing**.
That is strictly worse than a red test, because it destroys trust in the whole suite.

Three rules make healing safe:

1. **Ambiguity is failure.** If a fallback matches more than one element, do not guess —
   throw. Silent guessing is the whole danger.
2. **Healing is always reported.** A heal that nobody sees is technical debt that
   compounds until the suite is fiction.
3. **Healing is temporary.** It buys one run's worth of time. The report exists so the
   page object gets fixed.

If you cannot satisfy all three, use a plain locator and let the test fail honestly.

---

## The candidate ladder

Order candidates most-stable first. Stability means "survives a refactor that a user
would not notice".

| Rank | Strategy | Why it ranks here |
|---|---|---|
| 1 | `getByTestId('submit')` | Explicit contract; only changes deliberately |
| 2 | `getByRole('button', { name: 'Sign in' })` | Semantic + user-visible; survives markup churn |
| 3 | `getByLabel('Email')` | Tied to the accessible label |
| 4 | `getByPlaceholder('you@example.com')` | Visible, but copy changes more freely |
| 5 | `getByText(/sign in/i)` | Text-only; may match several nodes |
| 6 | `locator('form.login button[type=submit]')` | Structural; breaks on redesign — last resort |

Never include a candidate that is *less* specific than the one above it in a way that
could match a different element. A fallback that matches the wrong thing is the failure
mode this whole skill exists to prevent.

---

## Implementation — Playwright

Copy `pages/support/healing-locator.ts` from the plugin templates (setup does this), or
create it with this content:

```ts
// pages/support/healing-locator.ts
import { type Page, type Locator } from '@playwright/test';

export interface Candidate {
  /** How this candidate finds the element. */
  readonly find: (page: Page) => Locator;
  /** Human-readable description, used in reports. */
    readonly label: string;
}

export interface HealEvent {
  element: string;
  usedLabel: string;
  usedRank: number;
  primaryLabel: string;
  url: string;
}

/** Collected during a run; the reporter writes these into the HTML report. */
export const healEvents: HealEvent[] = [];

/**
 * Resolve `element` by trying each candidate in order.
 *
 * Returns the first candidate that matches EXACTLY ONE element. A candidate that
 * matches several is skipped and recorded — never guessed at, because picking one
 * arbitrarily can make a test assert against the wrong element and pass.
 *
 * Throws if nothing resolves unambiguously.
 */
export async function heal(
  page: Page,
  element: string,
  candidates: Candidate[],
  timeoutMs = 5_000,
): Promise<Locator> {
  if (!candidates.length) throw new Error(`heal("${element}"): no candidates supplied`);

  const attempts: string[] = [];
  const perCandidate = Math.max(500, Math.floor(timeoutMs / candidates.length));

  for (let i = 0; i < candidates.length; i++) {
    const { find, label } = candidates[i];
    let locator: Locator;
    try {
      locator = find(page);
    } catch (err) {
      attempts.push(`${label}: invalid locator (${(err as Error).message})`);
      continue;
    }

    try {
      // Wait for at least one match, then insist it is the only one.
      await locator.first().waitFor({ state: 'attached', timeout: perCandidate });
    } catch {
      attempts.push(`${label}: no match`);
      continue;
    }

    const count = await locator.count();
    if (count !== 1) {
      attempts.push(`${label}: ambiguous (${count} matches) — refusing to guess`);
      continue;
    }

    if (i > 0) {
      healEvents.push({
        element,
        usedLabel: label,
        usedRank: i + 1,
        primaryLabel: candidates[0].label,
        url: page.url(),
      });
      process.stderr.write(
        `  [HEAL] "${element}" — primary "${candidates[0].label}" failed; ` +
        `used fallback #${i + 1} "${label}". Update the page object.\n`,
      );
    }
    return locator;
  }

  throw new Error(
    `heal("${element}"): no candidate resolved to exactly one element.\n` +
    attempts.map(a => `    - ${a}`).join('\n') +
    `\n  URL: ${page.url()}\n` +
    `  Either the element is genuinely gone (a real bug — report it) or every ` +
    `candidate is stale (fix the page object).`,
  );
}
```

### Using it in a page object

Healing belongs in the page object, never in a test:

```ts
// pages/login.page.ts
import { heal, type Candidate } from './support/healing-locator';

export class LoginPage extends BasePage {
  private readonly submitCandidates: Candidate[] = [
    { label: 'testid=login-submit', find: p => p.getByTestId('login-submit') },
    { label: 'role=button name="Sign in"', find: p => p.getByRole('button', { name: 'Sign in' }) },
    { label: 'role=button name=/log ?in/i', find: p => p.getByRole('button', { name: /log ?in/i }) },
  ];

  async signIn(email: string, password: string): Promise<void> {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    const submit = await heal(this.page, 'Login submit button', this.submitCandidates);
    await submit.click();
  }
}
```

### Which elements deserve candidates

Adding fallbacks everywhere doubles the page object for no benefit. Add them only where
churn is likely or the cost of a break is high:

| Add fallbacks | Keep a single locator |
|---|---|
| Primary CTAs (submit, save, continue) | Static headings |
| Elements in actively redesigned areas | Elements with a stable `data-testid` you own |
| Third-party auth widgets you do not control | Elements the spec touches once |
| Anything that already broke once | Anything inside a component object used everywhere |

A locator with no `data-testid` available is the strongest reason to add candidates.

---

## Implementation — Maestro

Maestro has no fallback primitive, but `runFlow` with a conditional gives the same shape:

```yaml
# screens/login.screen.yaml
appId: ${APP_ID}
---
- runFlow:
    when:
      visible:
        id: "login_submit"
    commands:
      - tapOn:
          id: "login_submit"

- runFlow:
    when:
      notVisible:
        id: "login_submit"
      visible: "Sign in"
    commands:
      - evalScript: ${output.healed = "login: fell back to text 'Sign in'"}
      - tapOn: "Sign in"
```

Then assert the screen advanced, so a missed tap fails loudly:

```yaml
- assertVisible: "My Day"
```

Read `output.healed` after the run and put it in the report. Maestro cannot detect
ambiguity, so on mobile prefer `id` and treat text fallbacks as strictly temporary.

---

## The healing report

Every run that heals must say so. The versioned reporter adds a section when
`healEvents` is non-empty:

```
Self-healing summary — 2 element(s) healed
────────────────────────────────────────────────────────────
Element              Primary (failed)        Used instead        Rank
Login submit button  testid=login-submit     role=button "Sign in"  2
Client search box    testid=client-search    label="Search"          3

These tests passed using fallbacks. The primary locators are stale — update the
page objects before the fallbacks drift too.
```

Wire it up by exporting `healEvents` from the reporter's import and rendering the table
in `onEnd()`.

### Treat the report as a work queue

| Healed elements | What it means | Action |
|---|---|---|
| 0 | Locators match reality | Nothing |
| 1–3 | Normal drift after a UI change | Update those page objects this sprint |
| 4+ | A refactor outran the suite | Re-run live verification for the screen and regenerate locators |
| Same element every run | The primary is permanently wrong | Fix it now; the fallback is load-bearing |

---

## When NOT to heal

Healing is wrong when a missing element **is** the bug:

- **Negative tests.** `expect(deleteButton).toBeHidden()` must not hunt for alternatives.
  Use a plain locator.
- **Permission and role checks.** If an admin-only button is absent for a normal user,
  that is the assertion. Healing could find a lookalike and hide a security regression.
- **Empty and error states.** The absence of a data row is the expected result.
- **Anything asserting a count.** Ambiguity is the signal, not an obstacle.

Rule of thumb: heal only when locating the element is a *precondition* of the test, never
when the element's presence is the *thing being verified*.

---

## Interaction with the live-verification stage

Candidates are harvested during live verification, not invented:

1. While inspecting the screen, capture for each key element: `data-testid`, ARIA role +
   accessible name, label text, and visible text.
2. Rank them by the ladder above.
3. Emit the top two or three as candidates.

A candidate that was never observed on the real screen is a guess, and a guessed fallback
is exactly how a suite starts passing against the wrong elements.

---

## Strict prohibitions

1. **Never accept an ambiguous match.** More than one match means throw, always.
2. **Never heal silently.** No event recorded and printed, no healing.
3. **Never let a fallback become permanent.** If it heals twice, fix the primary.
4. **Never use healing in negative assertions.** See "When NOT to heal".
5. **Never add a structural CSS/XPath candidate above a semantic one.**
6. **Never heal in a test file.** It belongs in the page object.
7. **Never suppress the final throw.** A test whose element is genuinely gone must fail.

---

## Additional resources

- Page object structure: `automaqa:page-objects`
- Playwright coding standards: `automaqa:playwright-skill`
- Maestro flow standards: `automaqa:maestro-skill`
