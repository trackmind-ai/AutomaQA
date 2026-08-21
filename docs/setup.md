# Setup and prerequisites

AutomaQA is setup-first: it assumes nothing is installed and verifies every dependency with a
version command before using it.

## Install the plugin

```bash
/plugin marketplace add trackmind-ai/automaqa
/plugin install automaqa@trackmind-automaqa
```

## Run setup

```bash
/automaqa:setup            # both web and mobile
/automaqa:setup web        # Playwright only
/automaqa:setup mobile     # Maestro only
```

Setup detects your OS, installs only what is missing, and finishes with a status table
listing every component and its state. Read that table — it is the authoritative answer to
"is my environment ready".

## What setup needs

### Web (Playwright)

| Component | Notes |
|---|---|
| Node.js | LTS, from [nodejs.org](https://nodejs.org). Provides `npm` and `npx`. |
| `@playwright/test` | Installed as a dev dependency in your project. |
| Chromium driver | `npx playwright install chromium`. |
| Chrome DevTools MCP | Required for live verification. Must be installed in Claude Code. |

### Mobile (Maestro)

| Component | Notes |
|---|---|
| Maestro CLI | `curl -Ls https://get.maestro.mobile.dev \| bash` on macOS/Linux; `scoop install maestro` on Windows. |
| Java 11+ | Required by Maestro. [Eclipse Temurin](https://adoptium.net) LTS. On Windows, tick "Set JAVA_HOME". |
| Maestro MCP | `claude mcp add --scope user maestro maestro mcp`. |
| A booted device | An Android emulator, iOS simulator, or connected device. |

Python is **not** required. The Excel pipeline is pure Node.js.

## What setup creates in your project

Setup writes into your working directory, never into the plugin:

```
package.json              dependencies (created if absent)
playwright.config.ts      copied from the plugin's template
tests/versioned-reporter.ts  copied from the plugin's template
tests/e2e/                your Playwright specs
specs/                    spec.md files and HTML reports
maestro/flows/            Maestro YAML flows
maestro/subflows/         reusable sub-flows
```

`test-results/` is deliberately not created. The reporter writes HTML directly from
in-memory data, with no intermediate JSON file.

## After registering an MCP server

MCP servers load at startup. If setup just registered the Maestro MCP, **restart Claude
Code** before running mobile tests.

## Chrome remote debugging

Live web verification needs Chrome listening on port 9222:

```bash
# macOS
open -a "Google Chrome" --args --remote-debugging-port=9222

# Linux
google-chrome --remote-debugging-port=9222 &
```

```powershell
# Windows
Start-Process "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" "--remote-debugging-port=9222"
```

## Repairing a broken environment

Re-run `/automaqa:setup`. It is idempotent: existing components are detected and left alone,
and `playwright.config.ts` is never overwritten — required settings are applied as targeted
edits.
