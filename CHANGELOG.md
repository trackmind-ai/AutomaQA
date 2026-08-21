# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
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
- 36 flake-engine tests covering classification, quarantine policy, persistence,
  corrupt-store recovery and history capping — including explicit proof that a
  consistently-failing test is never quarantined.
- `docs/test-health.md` covering thresholds, quarantine policy, whether to commit the
  history file, and a five-cause flake diagnosis guide.
- Consolidated `tests/playwright.config.ts` running the whole template behaviour suite
  (41 tests), wired into `npm test`, `validate.sh` and CI.
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
- Tests for the plugin itself: 28 intake-parser cases (`npm test`) and 5 healing-locator
  cases driven through a real browser, plus `tsconfig.json` and `npm run typecheck`.
- `docs/intake.md` documenting every supported format and the field mapping.
- `scripts/validate.sh` now also typechecks the TypeScript templates and runs the unit
  tests.
- `@types/node` as a dev dependency — the reporter and healing helper both need Node
  globals to typecheck in a user project.

### Changed
- `playwright.config.ts` now sets `retries: process.env.CI ? 1 : 0`. One retry in CI
  surfaces intra-run flakes without masking much; locally 0 keeps flakiness visible.
- `setup` scaffolds `tests/support/` and copies the flake-store and quarantine helpers.
- Skill `excel-to-spec` renamed to `import-cases`, reflecting that intake is no longer
  Excel-only. Invoke it as `/automaqa:import-cases`.
- `setup` now scaffolds `pages/`, `pages/components/`, `pages/support/` and
  `screens/`, and copies the healing helper into the project.
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

### Removed
- `scripts/pipeline/extract_excel.js`, superseded by `extract_cases.js` (which still
  reads Excel).

## [0.1.0] — 2026-08-19

First open-source release. The plugin was previously internal; this release restructures
it for public use.

### Added
- Marketplace manifest so the plugin installs via `/plugin marketplace add`.
- `docs/` — setup, workflow, authoring, and troubleshooting guides.
- `scripts/install.sh` and `scripts/install.ps1` prerequisite installers.
- `plugins/automaqa/templates/` — `playwright.config.ts` and `versioned-reporter.ts`
  are now shipped templates copied into the user's project by setup.
- MIT license, contribution guide, code of conduct, and security policy.
- CI workflow validating manifests and skill frontmatter.

### Changed
- Plugin renamed from `Testing` to `automaqa` (display name **AutomaQA**); all skill
  invocations are now `/automaqa:<skill>`.
- Plugin relocated to `plugins/automaqa/` to separate plugin source from repo metadata.
- `.gitignore` hardened to exclude local Claude state, workbooks, generated reports,
  and credentials.
- `bin/` renamed to `scripts/` and split into `pipeline/` and `hooks/`.

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
