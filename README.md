# AutomaQA

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![validate](https://github.com/trackmind-ai/AutomaQA/actions/workflows/validate.yml/badge.svg)](https://github.com/trackmind-ai/AutomaQA/actions/workflows/validate.yml)
[![CodeRabbit Pull Request Reviews](https://img.shields.io/coderabbit/prs/github/trackmind-ai/AutomaQA?utm_source=oss&utm_medium=github&utm_content=trackmind-ai%2FAutomaQA&labelColor=171717&color=FF570A&label=CodeRabbit+Reviews)](https://coderabbit.ai)
[![Claude Code Plugin](https://img.shields.io/badge/Claude%20Code-Plugin-D97757.svg)](.claude-plugin/marketplace.json)

A Claude Code plugin that **sets up your E2E testing stack and then drives it** —
[Playwright](https://playwright.dev) for web, [Maestro](https://maestro.dev) for mobile.

Most testing tooling assumes the environment already works. AutomaQA starts one step
earlier: it installs and verifies Node, Playwright, browser drivers, the Maestro CLI,
Java, and the Maestro MCP server — on Windows, macOS, and Linux — and only then begins
authoring and running tests.

---

## What it is — and what it isn't

**It is** a setup-first testing workflow. Run `/automaqa:setup` on a bare machine and it
reaches a verified, runnable state, printing a component-by-component status table.

**It is** spec-driven. Tests are derived from a reviewed `spec.md`, not improvised, so a
run is reproducible and reviewable.

**It is not** a test framework. Playwright and Maestro do the work; AutomaQA orchestrates
them.

**It is not** a code generator that guesses at your UI. Every selector is grounded in a
live screen inspection — Chrome DevTools MCP for web, Maestro MCP for mobile — before a
line of test code is written.

**It is** architected, not scripted. Tests are built on the Page Object Model, so a
locator lives in exactly one file, and high-churn elements get **self-healing** fallbacks
that refuse ambiguous matches rather than guessing.

**It is** self-monitoring. Every run appends to a per-test health history, so flaky
tests are classified from real pass rates and quarantined automatically — while a
consistently-failing test is never quarantined, because that would hide a real bug.

**It is** format-agnostic at intake. Testers hand over whatever they have — Excel, CSV,
JSON, Markdown, Gherkin, YAML, XML, plain text — and the importer reconciles the case
count so nothing is silently dropped.

---

## Install

Requires [Claude Code](https://claude.com/claude-code).

```bash
/plugin marketplace add trackmind-ai/automaqa
/plugin install automaqa@trackmind-automaqa
```

Then set up the toolchain:

```bash
/automaqa:setup            # both web and mobile
/automaqa:setup web        # Playwright only
/automaqa:setup mobile     # Maestro only
```

Scripted alternatives for the command-line prerequisites (Node, Playwright, browser
drivers, Maestro CLI, Java, and Maestro MCP registration):

```bash
bash scripts/install.sh          # macOS / Linux
powershell -File scripts/install.ps1   # Windows
```

**These scripts do not set up Chrome DevTools MCP or the Chrome remote-debugging
profile.** That step involves installing an interactive plugin, locating the user's
Chrome install, and — if Chrome is already running without the flag — asking before
closing it, none of which a non-interactive script can safely automate. Run
`/automaqa:setup` inside Claude Code to complete that half; see [setup.md](docs/setup.md).

---

## Usage

| Command | What it does |
|---|---|
| `/automaqa:setup [web\|mobile\|both]` | Install and verify the toolchain; scaffold dirs, config, reporter, and helpers |
| `/automaqa:import-cases <file>` | Import test cases from any supported format into reviewed `spec.md` files |
| `/automaqa:playwright-e2e` | Web: live-verify in Chrome, then author page objects and Playwright tests |
| `/automaqa:maestro-e2e` | Mobile: inspect the device, then author screen objects and Maestro flows |
| `/automaqa:page-objects` | Page Object Model structure — where locators live, how tests stay readable |
| `/automaqa:self-healing` | Ranked fallback locators with an ambiguity gate and a drift report |
| `/automaqa:flake-guard` | Flake detection, test-health history, and quarantine policy |

### Test-case intake formats

Auto-detected by extension, then by content sniffing. Force one with `--format=<fmt>`.

| Format | Extensions | Notes |
|---|---|---|
| Excel | `.xlsx` `.xlsm` `.xls` | One feature per sheet |
| Delimited | `.csv` `.tsv` | Comma, tab, semicolon or pipe auto-detected |
| JSON | `.json` | Arrays, `{test_cases}`, or Zephyr / TestRail / Xray exports |
| Markdown | `.md` | GFM tables, or headings with `Steps:` / `Expected:` lines |
| Gherkin | `.feature` | Given→precondition, When→steps, Then→expected, Examples→test data |
| YAML | `.yaml` `.yml` | Case list or `{features: [...]}` |
| XML | `.xml` | TestRail / Xray / generic `<testcase>` |
| Plain text | `.txt` | Numbered or bulleted lists |

Import is deliberately strict: a report title above the table, a header repeated
mid-file, and `Actual Result` / `Status` / `Comments` columns are all recognised and
excluded, and the importer reports the case count so you can reconcile it against the
source before any spec is written.

New to this? **[SAMPLE.md](SAMPLE.md) is a complete walkthrough** — one feature from a
bare machine to a passing suite, including how to lay out the Excel file.

Typical first run:

```bash
/automaqa:setup
/automaqa:import-cases ./MyTestCases.xlsx    # or .csv, .json, .feature, .md, ...
/automaqa:playwright-e2e
```

---

## How it works

Four stages, in order:

1. **Setup** — detect the OS, check every dependency with a version command, install only
   what is missing, verify the MCP connections, print a status table.
2. **Spec** — derive structured, ID'd test cases into `specs/<feature>/spec.md`. You review
   and approve before any test is written.
3. **Live verification** — drive the real app through the spec via MCP (Chrome DevTools for
   web, Maestro for mobile) and record what actually happens. Findings are captured in an
   HTML report *before* test code exists, so real bugs aren't encoded as expected behavior.
4. **Automation** — build page objects from the verified selectors, then write Playwright
   `.spec.ts` or Maestro `.yaml` against them, run, and iterate until green. Locators
   stay in page objects; specs stay readable as behaviour.

Reports are versioned: `specs/<feature>/report-v1.html`, `-v2`, and so on. Nothing is
overwritten, so runs stay comparable.

Each report also carries a **Test health** section: the suite flake rate, tests that
passed only after a retry, tests unreliable over time, and tests that are consistently
failing — listed separately and explicitly *not* quarantined, so a real bug is never
filed away as a flake.

---

## Repository layout

```
.claude-plugin/marketplace.json   Marketplace manifest
plugins/automaqa/
  .claude-plugin/plugin.json      Plugin manifest
  agents/                         test-orchestrator — routes web/mobile/both
  skills/                         setup, import-cases, playwright-e2e, playwright-skill,
                                  maestro-e2e, maestro-skill, page-objects, self-healing
  hooks/hooks.json                Pre/post run guidance hooks
  scripts/                        Intake pipeline + hook implementation (Node.js)
  templates/                      playwright.config.ts, versioned-reporter.ts,
                                  pages/support/healing-locator.ts,
                                  tests/support/{flake-store,quarantine}.ts
docs/                             Setup, workflow, authoring, intake, troubleshooting
scripts/                          install.sh, install.ps1, validate.sh
tests/                            The plugin's own tests (intake parser, healing locator)
```

The plugin ships **no sample tests and no sample specs** — everything under `tests/`,
`specs/`, and `maestro/` is created in *your* project by setup, and the plugin directory
is never modified.

---

## Documentation

- **[Walkthrough](SAMPLE.md)** — start here: a full worked example, Excel to green suite
- [Setup and prerequisites](docs/setup.md)
- [The testing workflow](docs/workflow.md)
- [Writing tests](docs/authoring.md) — page objects, self-healing, coding standards
- [Test health](docs/test-health.md) — flake detection, quarantine, and what to fix first
- [Test-case intake](docs/intake.md) — supported formats and how field mapping works
- [Troubleshooting](docs/troubleshooting.md)

## Development

```bash
npm install
npm run validate     # manifests, frontmatter, typecheck, unit tests, publish checks
npm test             # intake parser + hook notifier + template behaviour tests
npm run typecheck    # TypeScript templates
npm run test:docs    # SAMPLE.md's code examples still compile against the shipped templates
```

Run `test:docs` any time you change a shipped template — `SAMPLE.md` shows real code
against those templates, and a walkthrough with broken code is worse than none.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Issues and pull requests are welcome.

## License

[MIT](LICENSE)
