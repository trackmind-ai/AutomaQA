# The testing workflow

AutomaQA runs four stages in order. Each one produces something the next stage depends on, so
skipping ahead is what causes brittle tests.

```
setup  →  spec  →  live verification  →  automation
```

## Stage 1 — Setup

`/automaqa:setup`. Covered in [setup.md](setup.md). Ends in a verified toolchain.

## Stage 2 — Spec

A spec is the source of truth for what gets tested. Either write `specs/<feature>/spec.md`
yourself, or import from whatever format the tester has:

```bash
/automaqa:import-cases ./MyTestCases.xlsx      # or .csv .json .md .feature .yaml .xml .txt
```

Excel, CSV/TSV, JSON (including Zephyr / TestRail / Xray exports), Markdown, Gherkin,
YAML, XML and plain text are all read into one canonical structure. See
[intake.md](intake.md) for the full mapping.

**Reconcile the count before continuing.** The importer reports how many cases it found
per feature and what it skipped. If the tester says 40 and it found 37, resolve that
first — silently importing 37 makes three cases look tested when they never were.

One spec is produced per feature. Each follows a fixed nine-section format:

| Section | Purpose |
|---|---|
| Environment | URL, credentials source, platform |
| Feature Overview | What the feature does |
| Entity States | The states an entity can be in |
| Field Contracts | Per-field rules: required, format, length, error text |
| UI Reference | The selectors and labels actually present |
| Data Prerequisites | What must exist before tests run |
| Happy Path | The primary journey |
| Test Cases | ID'd cases grouped by type (positive, negative, boundary) |
| Acceptance Criteria | Conditions for the feature to pass |

**You review and approve the spec before any test is written.** The generator loops on your
feedback until you approve. This is the cheapest point to catch a misunderstanding.

## Stage 3 — Live verification

Before writing test code, AutomaQA drives the real application through the spec:

- **Web** — Chrome DevTools MCP: navigate, log in, interact, read the DOM and console.
- **Mobile** — Maestro MCP: `list_devices`, then `inspect_screen` to read the real view
  hierarchy before targeting any element.

Two things come out of this:

1. **Verified selectors.** Every locator used in automation was observed on a real screen,
   not guessed from a spec.
2. **A findings report** at `specs/<feature>/report.html`, written *before* test code exists.

That ordering matters. If verification finds a genuine bug, it is recorded as a bug. Writing
tests first tends to encode broken behavior as the expected result.

## Stage 4 — Automation

Now the tests get written, grounded in stage 3's findings:

Page objects come first, then tests:

- **Web** — page objects under `pages/` hold every locator; specs under
  `tests/e2e/<feature-slug>.spec.ts` hold only behaviour. See `page-objects`
  and `playwright-skill`.
- **Mobile** — screen objects under `screens/` hold every element id; flows under
  `maestro/flows/<feature>.yaml` compose them and hold the assertions. See
  `maestro-skill`.

Elements likely to churn get **self-healing** candidates: a ranked fallback list that
refuses ambiguous matches rather than guessing, and reports every heal so drift stays
visible. Never add fallbacks where an element's absence is the assertion.

Then run, read the failures, fix, and repeat until green.

## Choosing a platform

The `test-orchestrator` agent asks which platform you want before running anything:

| Answer | What runs |
|---|---|
| Web only | `/automaqa:playwright-e2e` — Maestro is not involved |
| Mobile only | `/automaqa:maestro-e2e` — standalone, no browser |
| Both | Playwright for web plus Maestro for mobile parity |

## Reports

Reports are versioned and never overwritten:

| File | Origin |
|---|---|
| `specs/<feature>/report.html` | Stage 3 live verification, written once |
| `specs/<feature>/report-v1.html` | First automated run |
| `specs/<feature>/report-v{N}.html` | Each subsequent run |

`N` auto-increments by counting existing `report-v*.html` files. Runs stay comparable over
time, which is the point.

Generation is handled by `tests/versioned-reporter.ts`, a custom Playwright reporter
registered in `playwright.config.ts`. It collects results in `onTestEnd()` and writes the
HTML in `onEnd()`. There is no `globalTeardown` and no JSON reporter — adding either breaks
the architecture rather than helping it.
