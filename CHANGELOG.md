# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] — 2026-08-25

First open-source release. The plugin was previously internal; this release restructures
it for public use and adds the flake-detection, page-object, self-healing, and
multi-format-intake foundations.

### Added
- Marketplace manifest so the plugin installs via `/plugin marketplace add`.
- `docs/` — setup, workflow, authoring, intake, test-health, and troubleshooting guides.
- `scripts/install.sh` and `scripts/install.ps1` prerequisite installers.
- `plugins/automaqa/templates/` — `playwright.config.ts`, `versioned-reporter.ts`,
  `pages/support/healing-locator.ts`, and `tests/support/{flake-store,quarantine}.ts`
  are shipped templates copied into the user's project by setup.
- MIT license, contribution guide, code of conduct, and security policy.
- CI workflow validating manifests, skill frontmatter, typechecking, and tests.
- **Flake detection and quarantine** (`flake-guard` skill, plus shipped
  `templates/tests/support/flake-store.ts` and `quarantine.ts`). Every run appends to
  `.automaqa/history.json`; tests are classified from cross-run pass rates and
  quarantined automatically once unreliable, then released automatically once they reach
  a 95% pass rate. Quarantined tests are skipped rather than deleted, so coverage is
  never lost silently.
- Two independent flake signals: intra-run (Playwright retried and the test then passed)
  and inter-run (pass rate over a rolling window).
- **A consistently-failing test is never quarantined.** Tests at or below a 5% pass rate
  are classified as broken, kept failing, and listed in the report under "real bugs, NOT
  quarantined". Quarantining them would hide a real bug behind a green build.
- `AUTOMAQA_QUARANTINE` env var with `on` / `off` / `only` modes, so the quarantined
  set can be run in isolation or ignored entirely.
- Test health section in every HTML report: suite flake rate, tests that flaked this run,
  tests unreliable over time, consistently-failing tests, and quarantine changes. Rows
  that passed only after a retry are badged FLAKY rather than PASS.
- `docs/test-health.md` covering thresholds, quarantine policy, whether to commit the
  history file, and a five-cause flake diagnosis guide.
- **Page Object Model** (`page-objects` skill). Locators live in `pages/` (web) and
  `screens/` (mobile), exactly once each; specs contain behaviour only. Covers page
  and component objects, the action/query split, and incremental migration of an
  existing suite.
- **Self-healing locators** (`self-healing` skill plus a shipped
  `templates/pages/support/healing-locator.ts`). Ranked candidates, and a hard
  ambiguity gate: a candidate matching more than one element is refused rather than
  guessed at, because guessing can make a test pass against the wrong element. Every
  heal is recorded and reported so drift stays visible.
- **Multi-format test-case intake** (`scripts/pipeline/extract_cases.js`). Excel,
  CSV/TSV, JSON (including Zephyr / TestRail / Xray exports), Markdown (tables or
  prose), Gherkin, YAML, XML and plain text, auto-detected by extension then by content
  sniffing, with `--format` to override. All formats emit one canonical shape.
- Scored header-row detection: report titles and banners above a table no longer become
  the header, repeated headers mid-file are skipped, and unrecognised columns
  (`Actual Result`, `Status`, `Comments`) are excluded rather than mapped to a guess.
- Multi-line delimiter sniffing, so a comma-free title line no longer causes a
  semicolon-delimited file to collapse into a single column.
- Case-count reconciliation as a blocking gate in `import-cases`: a mismatch between the
  source and the import must be resolved before specs are generated.
- `docs/intake.md` documenting every supported format and the field mapping.
- Tests for the plugin itself: 28 intake-parser cases, 11 hook-notifier cases, and 41
  template-behaviour cases (flake-store + healing-locator, the latter driven through a
  real browser) — all wired into `npm test`, `npm run validate`, and CI. Plus
  `tsconfig.json` and `npm run typecheck`, and `npm run test:docs`, which compiles
  `SAMPLE.md`'s code examples against the real shipped templates and checks the
  documented spec file leaks no locator.
- `@types/node` as a dev dependency — the reporter and healing helper both need Node
  globals to typecheck in a user project.

### Changed
- Plugin renamed from `Testing` to `automaqa` (display name **AutomaQA**); all skill
  invocations are now `/automaqa:<skill>`.
- Plugin relocated to `plugins/automaqa/` to separate plugin source from repo metadata.
- `.gitignore` hardened to exclude local Claude state, workbooks, generated reports,
  and credentials.
- `bin/` renamed to `scripts/` and split into `pipeline/` and `hooks/`.
- Skill `excel-to-spec` renamed to `import-cases`, reflecting that intake is no longer
  Excel-only. Invoke it as `/automaqa:import-cases`.
- `playwright.config.ts` now sets `retries: process.env.CI ? 1 : 0`. One retry in CI
  surfaces intra-run flakes without masking much; locally 0 keeps flakiness visible.
  Every place this value is documented or reproduced (the setup skill's copy-fallback,
  `docs/authoring.md`'s config-invariants table) now states the same value and rationale.
- `setup` scaffolds `tests/support/`, `pages/`, `pages/components/`, `pages/support/`,
  and `screens/`, and copies the flake-store, quarantine, and healing helpers into the
  project.
- `playwright-e2e` and `maestro-e2e` now build page/screen objects before authoring any
  test, and invoke `self-healing` for churn-prone elements.

### Fixed
- The reporter recorded a separate history entry for every retry attempt, so one run of a
  retried test counted two or three times and skewed the pass rate of exactly the flaky
  tests being measured. Only the final attempt is now recorded.
- Test ids duplicated the filename (`login.spec.ts :: login.spec.ts > case`) because
  Playwright's `titlePath()` includes both the project and the file name.
- `playwright.config.ts` used `bail: 0`, which is not a Playwright option and was
  silently ignored — so the documented "every test always runs" guarantee was not
  actually enforced. Corrected to `maxFailures: 0` and caught by the new typecheck.
- The Excel extractor hardcoded a `SKIP_SHEETS = {'care plan'}` list left over from an
  internal project, which silently dropped any sheet with that name.
- `scripts/hooks/hook.js` still printed `[Testing]` on every hook fire after the rename
  to AutomaQA, and its header comment referenced the removed `extract_excel.js` — both
  now read correctly, and a regression test (`tests/hook.test.js`) runs every known hook
  event and fails if either string reappears.
- Stale references to the removed `extract_excel.js`/`.py` script survived in
  `test-orchestrator.md` and the setup skill after the `extract_cases.js` consolidation;
  `scripts/validate.sh`'s stale-reference check now also scans `.js` files and matches
  `extract_excel`, so a renamed file can't silently leave references behind again.

### Removed
- All sample and generated content: the bundled `Login_Test_Cases.xlsx` workbook,
  the generated `specs/login-test-cases/` specs and reports, `test-results/`
  screenshots and traces, and the sample `tests/e2e/login-test-cases.spec.ts`.
- Python duplicates `extract_excel.py` and `t2_hook.py`. The pipeline is Node.js only,
  so Python is no longer a dependency.
- `.claude/settings.local.json`, which contained machine-specific absolute paths and
  permissions for scripts that no longer exist.
- The bundled `settings.json` pinning a default agent, and the committed
  `package-lock.json`.
- `scripts/pipeline/extract_excel.js`, superseded by `extract_cases.js` (which still
  reads Excel).
