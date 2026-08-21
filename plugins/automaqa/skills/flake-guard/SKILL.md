---
description: Flake detection, per-test health history, and quarantine policy — classify unreliable tests from cross-run pass rates, quarantine them so they stop blocking CI, and never quarantine a consistently-failing test because that would hide a real bug. Invoked after test runs and when a suite loses trust.
when_to_use: Use when tests pass and fail without code changes, when CI is red for unrelated reasons, when deciding whether to retry or quarantine a test, when a suite is no longer trusted, or when auditing test health. Trigger on "flaky", "flaky test", "intermittent failure", "quarantine", "test keeps failing randomly", "CI is unreliable", "passes locally fails in CI", "flake rate", "test health", "retry".
---

# Flake Guard

A flaky test is one that passes and fails without the code changing. A suite with a
meaningful flake rate stops being evidence: people re-run until green, then stop reading
results at all. That is how E2E suites die.

This skill measures flakiness, quarantines what is unreliable, and — critically —
refuses to quarantine what is simply broken.

---

## The rule that matters most

> **A test that fails *intermittently* is flaky. A test that fails *every time* is broken.
> Quarantine the first. Never the second.**

Quarantining a consistently-failing test hides a real bug behind a green build. That is
worse than the flaky test you were trying to fix, because now nobody is looking. The
engine enforces this: `consistentlyFailing` takes precedence over `flakyOverTime`, and a
test at or below a 5% pass rate is never quarantined regardless of how noisy it is.

---

## Two independent flake signals

| Signal | What it is | Strength |
|---|---|---|
| **Intra-run** | Playwright retried the test and it then passed | Conclusive — same code, same commit, different outcome |
| **Inter-run** | Pass rate over recent runs is neither ~100% nor ~0% | Strong, but needs history |

Intra-run flakes are visible immediately. Inter-run flakiness only emerges over time,
which is why history is persisted to `.automaqa/history.json`.

---

## Architecture

```
tests/support/flake-store.ts    History, classification, quarantine policy
tests/support/quarantine.ts     Fixture that skips quarantined tests
tests/versioned-reporter.ts     Records each run, applies policy, renders health
.automaqa/history.json          Per-test outcome history (commit this — see below)
```

Setup copies the first two into the project. The reporter wires itself up.

### Should `.automaqa/history.json` be committed?

| Situation | Recommendation |
|---|---|
| Tests run mainly in CI | **Commit it.** Otherwise every CI run starts with no history and nothing is ever classified. |
| Tests run mainly locally, per developer | Do not commit — histories would conflict constantly. |
| Large team, high churn | Commit, and treat conflicts by taking either side; history is statistical, not exact. |

Default to committing it. A history that resets every run can never detect an inter-run
flake, which defeats the purpose.

---

## Thresholds

Defaults in `DEFAULT_THRESHOLDS`:

| Setting | Default | Meaning |
|---|---|---|
| `window` | 20 | Runs scored. Older runs are kept but not counted. |
| `minSamples` | 5 | Runs needed before any verdict. Below this, nothing is quarantined. |
| `quarantineBelow` | 0.80 | Under this pass rate → quarantine-eligible |
| `brokenAtOrBelow` | 0.05 | At or under this → **broken, never quarantined** |
| `releaseAtOrAbove` | 0.95 | At or over this → released from quarantine automatically |

Skipped runs are excluded from scoring — a skip says nothing about correctness, and
counting them would dilute the pass rate of every quarantined test.

### Tuning

Raise `minSamples` on a suite that runs many times a day; lower `quarantineBelow` if
quarantine is catching tests that are merely slow rather than unreliable. Do **not** raise
`brokenAtOrBelow` much above `0.05` — that is the guard preventing broken tests from being
hidden.

---

## Retries: use them to *detect*, never to *hide*

```ts
// playwright.config.ts
retries: process.env.CI ? 1 : 0,
```

One retry in CI is the right setting. It surfaces intra-run flakes (Playwright reports
them as `flaky`, and the reporter records `retries > 0`) without masking much.

**Never set `retries: 2` or more to make a suite green.** Each retry roughly squares the
probability that a broken test slips through, and the failure it hides is exactly the
intermittent bug your users will hit. Retries are a measurement instrument here, not a
remedy.

Locally, keep `retries: 0` so flakiness is visible while you work.

---

## Workflow

### After a run

Read the reporter's **Test health** output:

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

Then act by section:

| Section | Meaning | Action |
|---|---|---|
| Flaked in this run | Retried and passed | Investigate now — the cause is fresh |
| Unreliable over time | Mixed outcomes across runs | Quarantined automatically; fix from the queue |
| Consistently failing | Broken | **Fix the bug or the test.** Never quarantine. |
| Currently quarantined | Held out of the build | Work the list down; it is debt |

### Suite-level judgement

| Flake rate | Verdict | Action |
|---|---|---|
| 0% | Trustworthy | Nothing |
| < 5% | Normal for E2E | Fix opportunistically |
| 5–15% | Eroding | Schedule dedicated time |
| > 15% | Not evidence any more | Stop adding tests; fix flakiness first |

---

## Diagnosing a flake

Flakiness is almost always one of five causes. Work through them in order — the first two
account for most cases.

### 1. Waiting on time instead of state

```ts
await page.waitForTimeout(2000);              // ✗ passes on a fast machine, fails on CI
await expect(page.getByRole('alert')).toBeVisible();   // ✓ waits for the condition
```

The single most common cause. Any fixed sleep is a flake waiting for a slow day.

### 2. Test interdependence

A test that depends on data another test created will fail when run alone, in a different
order, or in parallel. Confirm with:

```bash
npx playwright test path/to/one.spec.ts -g "the flaky test"
```

Passes alone but fails in the suite → shared state. Generate unique data per test.

### 3. Racing the network or animation

Asserting immediately after an action that triggers a request or transition. Wait for the
settled state — a response, a URL, an element's final position — not for the click to
return.

### 4. Non-unique locators

A locator matching two elements resolves to whichever renders first, which can vary. The
`self-healing` helper refuses ambiguous matches for exactly this reason; see
`automaqa:self-healing`.

### 5. Genuine product race conditions

Sometimes the test is right and the app is flaky. This is the most valuable finding
here — **do not quarantine it.** File the bug. A test catching a real intermittent
product defect is doing its job.

> Before quarantining anything, ask: *is this the test being unreliable, or the product?*
> Quarantine only answers the first.

---

## Quarantine in practice

Import the fixture instead of `@playwright/test`:

```ts
import { test, expect } from '../support/quarantine';
```

Quarantined tests are then skipped with a reason naming their pass rate, so the report
explains itself.

### Modes

```bash
npx playwright test                              # quarantined tests skipped (default)
AUTOMAQA_QUARANTINE=only npx playwright test     # run ONLY quarantined tests
AUTOMAQA_QUARANTINE=off  npx playwright test      # ignore quarantine entirely
```

Use `only` when working through the backlog. Use `off` to check whether they now pass, and
to let green runs accumulate so they can be released.

### Release is automatic

Once a quarantined test reaches a 95% pass rate over enough runs, it is released and
reported as `RELEASED`. Nobody has to remember to un-quarantine anything — which is why
quarantine here does not become a graveyard.

### Quarantine is debt, and it has a limit

Quarantine buys time; it does not fix anything. Two guardrails:

- **Cap it.** If more than ~2% of the suite is quarantined, stop adding tests and fix.
- **Never quarantine to make a release green.** If a test is unreliable and the feature
  ships tonight, say so plainly. A silent quarantine is a decision nobody reviewed.

---

## Strict prohibitions

1. **Never quarantine a consistently-failing test.** It hides a real bug.
2. **Never raise `retries` to make a suite pass.** Retries measure flakiness; they do not
   fix it.
3. **Never `waitForTimeout()` as synchronisation.** Wait for state.
4. **Never delete a flaky test instead of quarantining it.** Deleting loses the coverage
   silently; quarantine keeps it visible and releases it automatically.
5. **Never quarantine without recording why.** The engine stores the pass rate and date;
   do not bypass it by adding a bare `test.skip()`.
6. **Never treat a product race condition as a test flake.** File the bug.
7. **Never let the flake rate go unread.** An unmeasured suite is an untrusted one.

---

## Additional resources

- Locator ambiguity as a flake source: `automaqa:self-healing`
- Test structure and isolation: `automaqa:page-objects`
- Playwright standards, including waiting: `automaqa:playwright-skill`
