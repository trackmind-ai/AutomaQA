# Test health

A flaky test is one that passes and fails without the code changing. Once a suite has a
meaningful flake rate, people re-run until green and then stop reading results at all —
which is how E2E suites lose their value.

AutomaQA tracks per-test health across runs, classifies each test, and quarantines the
unreliable ones automatically.

---

## The rule that matters most

> **A test that fails *intermittently* is flaky. A test that fails *every time* is broken.
> Quarantine the first. Never the second.**

Quarantining a consistently-failing test hides a real bug behind a green build — worse
than the flake you were trying to fix, because now nobody is looking. The engine enforces
this: any test at or below a 5% pass rate is classified `consistentlyFailing` and is never
quarantined, no matter how noisy the suite is.

Reports list those tests under **"Consistently failing — real bugs, NOT quarantined"** so
the distinction is visible rather than implied.

---

## How it works

```
tests/support/flake-store.ts    History, classification, quarantine policy
tests/support/quarantine.ts     Fixture that skips quarantined tests
tests/versioned-reporter.ts     Records each run, applies policy, renders health
.automaqa/history.json          Per-test outcome history
```

Two independent flake signals are recorded:

| Signal | What it is | Strength |
|---|---|---|
| **Intra-run** | Playwright retried the test and it then passed | Conclusive — same code, same commit, different outcome |
| **Inter-run** | Pass rate over recent runs is neither ~100% nor ~0% | Strong, but needs history |

Skipped runs are excluded from scoring: a skip says nothing about correctness, and
counting them would dilute the pass rate of exactly the tests being measured.

---

## Retries: detect, never hide

```ts
// playwright.config.ts — shipped default
retries: process.env.CI ? 1 : 0,
```

One retry in CI surfaces intra-run flakes: Playwright reports the test as `flaky`, and the
reporter records `retries > 0`. Locally the default is `0`, so flakiness stays visible
while you work.

**Never raise `retries` to make a suite green.** Each retry roughly squares the chance a
broken test slips through, and the failure it hides is precisely the intermittent bug your
users will hit. Retries are a measurement instrument, not a remedy.

---

## Thresholds

| Setting | Default | Meaning |
|---|---|---|
| `window` | 20 | Runs scored; older runs kept but not counted |
| `minSamples` | 5 | Runs needed before any verdict |
| `quarantineBelow` | 0.80 | Under this pass rate → quarantine-eligible |
| `brokenAtOrBelow` | 0.05 | At or under this → **broken, never quarantined** |
| `releaseAtOrAbove` | 0.95 | At or over this → released automatically |

Tune in `DEFAULT_THRESHOLDS` in `tests/support/flake-store.ts`. Raise `minSamples` on a
suite that runs many times a day. Do **not** raise `brokenAtOrBelow` far above `0.05` —
that is the guard keeping broken tests out of quarantine.

---

## Should `.automaqa/history.json` be committed?

| Situation | Recommendation |
|---|---|
| Tests run mainly in CI | **Commit it.** Otherwise every CI run starts blind and no inter-run flake is ever detected. |
| Tests run mainly locally, per developer | Do not commit — histories would conflict constantly. |
| Large team, high churn | Commit; on conflict take either side. History is statistical, not exact. |

The repo's `.gitignore` ignores `.automaqa/*` but explicitly un-ignores `history.json`, so
committing it is the default path.

---

## Quarantine

Import the fixture instead of `@playwright/test`:

```ts
import { test, expect } from '../support/quarantine';
```

Quarantined tests are skipped with a reason naming their pass rate and quarantine date, so
the report explains itself without a lookup.

### Modes

```bash
npx playwright test                              # quarantined tests skipped (default)
AUTOMAQA_QUARANTINE=only npx playwright test     # run ONLY quarantined tests
AUTOMAQA_QUARANTINE=off  npx playwright test     # ignore quarantine entirely
```

Use `only` to work through the backlog in isolation. Use `off` to check whether they now
pass — and to let green runs accumulate so they can be released.

### Release is automatic

Once a quarantined test reaches a 95% pass rate over enough runs, it is released and
reported as `RELEASED`. Nobody has to remember to un-quarantine anything, which is why
quarantine here does not become a graveyard.

### It is still debt

- **Cap it.** If more than ~2% of the suite is quarantined, stop adding tests and fix.
- **Never quarantine to make a release green.** If a test is unreliable and the feature
  ships tonight, say so. A silent quarantine is a decision nobody reviewed.

---

## Reading the report

```
Test health
────────────────────────────────────────────────────────────
tracked: 42   flake rate: 4.8%

Flaked in this run (passed only after a retry):
  tests/e2e/checkout.spec.ts :: applies discount code
    passed only after 1 retry(ies) this run

Consistently failing — real bugs, NOT quarantined:
  tests/e2e/login.spec.ts :: rejects expired token
    failed 8/8 runs — broken, not flaky
```

| Section | Meaning | Action |
|---|---|---|
| Flaked in this run | Retried and passed | Investigate now — the cause is fresh |
| Unreliable over time | Mixed outcomes across runs | Quarantined automatically; fix from the queue |
| Consistently failing | Broken | **Fix the bug or the test.** Never quarantine. |
| Currently quarantined | Held out of the build | Work the list down |

### Suite-level judgement

| Flake rate | Verdict | Action |
|---|---|---|
| 0% | Trustworthy | Nothing |
| < 5% | Normal for E2E | Fix opportunistically |
| 5–15% | Eroding | Schedule dedicated time |
| > 15% | Not evidence any more | Stop adding tests; fix flakiness first |

---

## Diagnosing a flake

Five causes, in order of how often they are the answer.

**1. Waiting on time instead of state** — by far the most common.

```ts
await page.waitForTimeout(2000);                        // ✗ fails on a slow day
await expect(page.getByRole('alert')).toBeVisible();    // ✓ waits for the condition
```

**2. Test interdependence.** Confirm by running the test alone:

```bash
npx playwright test path/to/one.spec.ts -g "the flaky test"
```

Passes alone but fails in the suite → shared state. Generate unique data per test.

**3. Racing the network or an animation.** Wait for the settled state — a response, a URL,
a final position — not for the click to return.

**4. Non-unique locators.** A locator matching two elements resolves to whichever renders
first, which can vary. See [authoring.md](authoring.md#self-healing-locators).

**5. A genuine product race condition.** Sometimes the test is right and the app is flaky.
This is the most valuable finding here — **do not quarantine it.** File the bug.

> Before quarantining anything, ask: *is the test unreliable, or the product?* Quarantine
> only answers the first.

---

## Prohibitions

1. Never quarantine a consistently-failing test.
2. Never raise `retries` to make a suite pass.
3. Never use `waitForTimeout()` as synchronisation.
4. Never delete a flaky test instead of quarantining it — deleting loses coverage silently.
5. Never bypass the engine with a bare `test.skip()`; the reason and pass rate would be lost.
6. Never treat a product race condition as a test flake.
