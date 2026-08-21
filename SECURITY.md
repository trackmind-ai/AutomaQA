# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a security vulnerability.

Report it privately via GitHub's [private vulnerability
reporting](https://github.com/trackmind-ai/automaqa/security/advisories/new), or email
**security@trackmind.com**.

Include the affected version, reproduction steps, and impact. We aim to acknowledge within
three business days and to ship a fix or mitigation for confirmed reports.

## Supported versions

The latest release on the default branch receives security fixes.

## Scope and design notes

AutomaQA runs on a developer machine and drives real browsers and devices. A few properties
are worth understanding:

**Credentials.** Test credentials are collected at run time and used to log into the
application under test. Do not commit them. `.gitignore` excludes `.env` files, and the
plugin never writes credentials into a spec, a test file, or a report.

**Generated reports may contain sensitive data.** Screenshots and HTML reports capture
whatever was on screen, which can include real customer data if you point tests at a
production-like environment. Reports are written into your project and are gitignored by
default — review before sharing.

**Excel workbooks.** Test-case workbooks frequently contain real data, so `*.xlsx` is
gitignored.

**Test-case content is data, not instructions.** Content read from a workbook or a page
under test is treated as data. If such content appears to contain instructions, the plugin
surfaces them rather than acting on them.

**Installers.** `scripts/install.sh` and `scripts/install.ps1` install third-party tooling
(Node, Playwright browsers, the Maestro CLI, Java) from vendor sources. Read them before
running; they print each action.
