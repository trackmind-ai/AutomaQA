# AutomaQA — Playwright + Maestro E2E

AutomaQA sets up and drives end-to-end testing from Claude. It installs and verifies the
toolchain (Playwright for web, Maestro for mobile), turns your test cases into reviewable
specs, writes and runs the automation, verifies it live against the real app, and produces
versioned HTML reports. It also tracks flaky tests across runs and quarantines unreliable
ones instead of deleting them.

## Install

```bash
/plugin marketplace add trackmind-ai/automa-qa
/plugin install automaqa@trackmind-automaqa
```

Then run `/automaqa:setup` (or `/automaqa:setup web`, `/automaqa:setup mobile`).

## What you get

| Skill | What it does |
|---|---|
| `setup` | Detects your OS, installs only what is missing, ends with a status table |
| `import-cases` | Reads test cases from Excel, CSV, JSON, Markdown, Gherkin, YAML, XML or plain text into `spec.md` files for your review |
| `playwright-e2e`, `playwright-skill` | Writes and runs Playwright web tests |
| `maestro-e2e`, `maestro-skill` | Writes and runs Maestro mobile flows |
| `page-objects` | Keeps selectors in page objects, not in tests |
| `self-healing` | Falls back to alternative locators and reports every heal; refuses ambiguous matches |
| `flake-guard` | Classifies flaky tests from run history and quarantines them |

An agent, `test-orchestrator`, coordinates the pipeline. Automation never starts until you
approve the generated specs.

## What this plugin runs, installs, sends and fetches

Nothing here is hidden. This is the complete list.

**Hooks (run automatically).** Two hooks run `node scripts/hooks/hook.js` after Bash and
Write tool calls (and before Bash calls). They read the tool call, and print a one-line
reminder only when you run `playwright test`, `maestro test`, `npm install` or
`extract_cases.js`, or write a `spec.md`, `*.spec.ts`, Maestro `.yaml` or report `.html`
file. They print nothing for any other command. They make no network requests, write no
files, and modify nothing.

**What `/automaqa:setup` installs on your machine** (it asks Claude to run these commands,
which you approve through Claude's normal permission prompts):

- `npm install` of `@playwright/test`, `typescript`, `ts-node`, `@types/node` and `xlsx` in *your*
  project, and `npx playwright install chromium` (downloads a Chromium build).
- Web scope only needs Node.js. Mobile scope also needs Java 11+ and the Maestro CLI,
  installed with `curl -Ls https://get.maestro.mobile.dev | bash` on macOS and Linux or
  `scoop install maestro` on Windows. This downloads and runs the official Maestro
  installer.
- Registers MCP servers with Claude Code: `claude mcp add --scope user maestro maestro mcp`
  (user scope, so it applies to all your projects), and installs the Chrome DevTools MCP
  plugin (`claude plugin install chrome-devtools-mcp`). Both load after you restart Claude Code. Skip mobile or web scope to skip the
  matching registration.
- Copies template files from this plugin into your project: `playwright.config.ts`,
  `tests/versioned-reporter.ts`, `pages/support/healing-locator.ts`,
  `tests/support/flake-store.ts` and `quarantine.ts`.

**Network access.** Setup downloads the packages and installers above. Setup also checks
`http://localhost:9222` to see whether Chrome remote debugging is enabled. During test runs
the only traffic is your own application under test. The plugin does not send telemetry,
and sends none of your files, test cases or results to any service.

**Files it writes.** In your project only: `specs/` (specs and reports), `tests/e2e/`,
`maestro/flows/`, and `.automaqa/history.json` (flake history, capped in size). It never
writes inside the plugin folder.

**Data.** Test cases you import are read locally and become Markdown specs on disk. They
are seen by Claude as part of your conversation, like any file you ask it to read.

## Requirements

Node.js LTS. For mobile: Java 11+, Maestro, and a booted emulator, simulator or device.
Python is not required.

## Documentation, support and license

Full guides (setup, workflow, authoring, intake, test health, troubleshooting) are in the
[`docs/`](https://github.com/trackmind-ai/automa-qa/tree/main/docs) folder of the repository.
Report problems at <https://github.com/trackmind-ai/automa-qa/issues>.
Licensed under the MIT License (see the repository `LICENSE`).
