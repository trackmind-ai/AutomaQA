# Troubleshooting

## Setup

**Setup says a tool is missing that I know is installed.**
It is not on `PATH` for the shell Claude Code spawned. Verify with `node -v`,
`maestro --version`, or `java -version` in a fresh terminal. On macOS/Linux, Maestro needs
`export PATH="$PATH:$HOME/.maestro/bin"` in your shell profile; on Windows, restart the
terminal after a PATH change.

**Setup wants me to install Python.**
It should not — the pipeline is Node.js only. Reinstall the plugin; you are on an old copy.

## MCP

**Maestro MCP is unavailable right after registering it.**
MCP servers load at startup. Restart Claude Code. If it still does not appear, confirm with
`claude mcp list`, then re-run `claude mcp add --scope user maestro maestro mcp`.

**`list_devices` returns an empty list.**
Expected on a fresh machine — nothing is booted. Start an Android emulator or iOS simulator,
or connect a device, then call it again. Only use device IDs the tool actually returns.

**Chrome DevTools MCP is not responding.**
Chrome must be running with remote debugging on port 9222. See
[setup.md](setup.md#chrome-remote-debugging). Also confirm the Chrome DevTools MCP plugin is
installed in Claude Code.

## Reports

**No report was generated after a run.**
Check that `playwright.config.ts` registers the reporter:

```ts
reporter: [['list'], ['./tests/versioned-reporter.ts']]
```

Then confirm `tests/versioned-reporter.ts` exists. Re-running `/automaqa:setup` restores both.

**Reports stopped being generated after I edited the config.**
The usual cause is a `globalTeardown` entry or a `json` reporter added to the config. Both
belong to an older architecture and neither generates reports. Remove them — the versioned
reporter writes HTML directly from in-memory data.

**A report overwrote the previous one.**
`report.html` is the live-verification report and is written once. Automated runs write
`report-v{N}.html` and never overwrite. If versions are not incrementing, check whether
something is deleting `specs/<feature>/report-v*.html` between runs — `N` is derived by
counting those files.

## Tests

**One failure aborted the whole suite.**
The suite is using `test.describe.serial()` for tests that are actually independent. Switch
to `test.describe()` with `beforeEach`. See [authoring.md](authoring.md#pick-the-structure-first).

**Tests pass alone but fail together.**
Shared state. `workers` is `1` by design, so this is usually test data one test mutates and
another depends on. Generate unique data per test.

**A selector works during live verification but fails in the test.**
Usually a timing difference rather than a wrong selector: verification is slow and manual,
the test is fast. Wait for the condition with a web-first assertion instead of a fixed
timeout.

**Login works manually but not in tests.**
Every test starts with a fresh cookie-free context — no `storageState` is configured. The
test must perform the login itself. For third-party providers (Auth0, Okta), the redirect
lands on a different origin, so wait for the provider's URL pattern before interacting.

## Intake

**The importer found fewer cases than the file contains.**
Re-run with `--verbose`. It prints which row it treated as the header and how many rows it
skipped. The usual causes are a wrong delimiter (a comma-free title line above a
semicolon-delimited table) or merged cells. Force the parser with `--format=<fmt>`, or ask
for an unmerged copy.

**A column was ignored that I needed.**
`--verbose` names every unrecognised column. Add the synonym to `COLUMN_MAP` in
`scripts/pipeline/extract_cases.js`. Note that `Actual Result`, `Status` and
`Comments` are excluded deliberately — they record a past run, not the specification.

**"No test cases found" on a file that clearly has them.**
Detection picked the wrong parser. Force it: `--format=csv`, `markdown`, `gherkin`,
`yaml`, `xml`, `json`, `text` or `xlsx`.

**`ERROR: Excel input needs the xlsx package`.**
Run `npm install xlsx` in your project. Only Excel needs it.

## Page objects and self-healing

**One UI change broke many tests.**
Locators are duplicated across specs. Run
`grep -rn "getByRole\|getByLabel\|getByTestId\|locator(" tests/` — any output is a locator
that belongs in a page object. Migrate one spec at a time; see
[authoring.md](authoring.md#architecture-in-one-rule).

**`heal(): no candidate resolved to exactly one element`.**
Either the element is genuinely gone — a real bug, report it — or every candidate is
stale. The error lists each attempt and why it failed. Re-run live verification for that
screen and regenerate the locators.

**`ambiguous (N matches) — refusing to guess`.**
Working as designed. The candidate matched several elements, so it was skipped rather
than picking one arbitrarily. Make the candidate more specific — scope it to a container,
or use a role plus an accessible name.

**Tests pass but the report lists heals every run.**
The primary locators are permanently wrong and the fallbacks are load-bearing. Fix the
page objects now; a fallback that drifts leaves nothing behind it.

**A negative test passes when it should fail.**
Check whether it uses `heal()`. Healing must never be used where an element's absence is
the assertion — it can find a lookalike and hide the regression. Use a plain locator.

## Still stuck

Open an issue with your OS, Claude Code version, the skill you invoked, and the full setup
status table: <https://github.com/trackmind-ai/automaqa/issues>
