# Test-case intake

Testers hand over test cases in whatever their team uses. AutomaQA reads all of it and
produces one canonical structure, so the rest of the pipeline never cares where the cases
came from.

```bash
/automaqa:import-cases ./MyTestCases.xlsx
/automaqa:import-cases ./exported-from-testrail.xml
/automaqa:import-cases ./login.feature
```

Under the hood this runs `scripts/pipeline/extract_cases.js`, which you can also call
directly:

```bash
node plugins/automaqa/scripts/pipeline/extract_cases.js <input> [output.json] --verbose
```

---

## Supported formats

Format is detected by extension first, then by sniffing the file's content — so a file
with no extension, or a `.txt` that is really CSV, still works.

| Format | Extensions | How it maps |
|---|---|---|
| Excel | `.xlsx` `.xlsm` `.xls` | One feature per sheet; header row auto-located |
| Delimited | `.csv` `.tsv` | Comma, tab, semicolon or pipe auto-detected |
| JSON | `.json` | Array, `{test_cases}`, `{features}`, or Zephyr / TestRail / Xray export |
| Markdown | `.md` `.markdown` | GFM tables (one feature per heading), or headings + labelled prose |
| Gherkin | `.feature` | Given→precondition, When→steps, Then→expected, Examples→test data |
| YAML | `.yaml` `.yml` | A case list, or `{features: [...]}` |
| XML | `.xml` | TestRail / Xray / generic `<case>` `<testcase>` `<test>` |
| Plain text | `.txt` | Numbered or bulleted lists with `Steps:` / `Expected:` lines |

If detection picks the wrong parser, force it:

```bash
--format=xlsx|csv|json|markdown|gherkin|yaml|xml|text
```

Only Excel needs a dependency (`xlsx`). Every other format uses the Node standard library.

---

## The canonical shape

Every format produces exactly this, so `spec.md` generation is format-agnostic:

```json
{
  "source_file": "Login.xlsx",
  "source_format": "xlsx",
  "features": [
    {
      "name": "Login",
      "raw_columns": ["TC ID", "Test Scenario", "Expected Result"],
      "test_cases": [
        {
          "id": "TC_001",
          "type": "Positive",
          "scenario": "Valid login redirects to dashboard",
          "steps": "1. Open /login\n2. Submit valid credentials",
          "expected": "Dashboard loads",
          "precondition": "User is registered",
          "test_data": ""
        }
      ]
    }
  ],
  "warnings": []
}
```

All seven fields are always present as strings. Missing values are `""`, never absent, so
downstream code needs no defensive checks.

---

## Field mapping

Column and key names are matched case-insensitively against a synonym table, then by
substring — so `Expected Result (UI)` still lands on `expected`. Exports from the common
tools map without renaming anything:

| Canonical | Recognised as (partial list) |
|---|---|
| `id` | TC ID, Test ID, Case ID, Key, Issue Key, Ref, Sr No |
| `type` | Test Type, Scenario Type, Category, Priority, Severity, Labels, Tags |
| `scenario` | Test Scenario, Test Case, Title, Summary, Name, Description, Objective |
| `steps` | Test Steps, Steps, Action, Test Procedure, Steps to Reproduce |
| `expected` | Expected Result, Expected, Result, Acceptance Criteria, Assertion |
| `precondition` | Pre-Condition, Preconditions, Prerequisites, Setup, Given, Context |
| `test_data` | Test Data, Data, Input, Inputs, Parameters, Sample Data |

To teach it a new synonym, add one line to `COLUMN_MAP` in `extract_cases.js`.

### Deliberately never imported

`Actual Result`, `Status`, `Pass/Fail`, `Comments`, `Notes`, `Remarks`, `Tester`,
`Executed On`.

These describe a *past run*, not the specification. Importing them would bake one run's
outcome into the spec — so a test could be generated that asserts last month's bug is the
expected behaviour. `--verbose` names every column it ignored, so nothing is dropped
without you being able to see it.

---

## Why intake is strict

The worst failure in test-case intake is not a crash — it is silently importing 37 of 40
cases. The three missing cases look tested when they were never imported at all.

The importer therefore refuses to guess:

| Situation | What happens |
|---|---|
| A report title or banner sits above the table | Rows are scored; the real header is found, and rows above it are skipped and counted |
| The header repeats mid-file (merged sheets) | Recognised and skipped, not collected as a case |
| A column is unrecognised | Ignored and named in `--verbose`, never mapped to a guess |
| Blank rows | Skipped and counted |
| The file is empty | Hard error, exit 1 |
| The content has no recognisable structure | Hard error listing what was expected — it never invents cases |

Detection failures are loud on purpose. A clear error beats a spec built from a
misread file.

### Always reconcile the count

`--verbose` prints the case count per feature. Compare it against the source before
generating any spec:

```
[INFO] parsing as csv
[INFO] delimiter detected: ";"
[INFO] 'Login': header found on row 3; 2 row(s) above it ignored
[INFO] Column 'Actual' is not a recognised field — ignored
[INFO] Column 'Status' is not a recognised field — ignored
[INFO] 'Login': ignored 1 repeated header row(s)
[INFO] extracted 2 case(s) across 1 feature(s)
```

If the tester says 40 and the importer found 37, resolve that before continuing.

| Symptom | Likely cause | Fix |
|---|---|---|
| Far too few cases | Wrong header row, or wrong delimiter | Check the `--verbose` header and delimiter lines; force `--format` |
| One case per sheet | Merged cells in the source | Ask for an unmerged copy |
| Empty scenarios | No recognised title column | Confirm which column holds the case name |
| Extra junk cases | Trailing notes rows below the table | Confirm, then ignore them |

---

## Writing cases by hand

If there is no export to work from, the two most pleasant formats to write are Markdown
and YAML.

**Markdown table** — one feature per heading:

```markdown
# Login

| TC ID | Type | Test Scenario | Pre-Condition | Steps | Expected Result |
|---|---|---|---|---|---|
| TC_001 | Positive | Valid login | User registered | Open /login, submit | Dashboard loads |
| TC_002 | Negative | Blank email | — | Submit empty form | "Email is required" |
```

**Markdown prose** — when a table is too rigid:

```markdown
## TC_001 - Verify user can log in
Precondition: account exists
Steps: open login, enter credentials, submit
Expected: dashboard is shown
```

**YAML** — good for long, multi-line steps:

```yaml
feature: Login
test_cases:
  - id: TC_001
    type: Positive
    scenario: Valid login
    precondition: user exists
    steps: |
      1. Open /login
      2. Submit valid credentials
    expected: Dashboard loads
```

**Gherkin** — if the team already writes BDD:

```gherkin
Feature: Login

  @smoke @TC_001
  Scenario: Valid login
    Given I am on the login page
    When I enter valid credentials
    Then I see the dashboard
```

A tag matching an id pattern (`@TC_001`) becomes the case `id`; other tags become `type`.

---

## Extending the importer

To add a format, add a parser function and register it in `PARSERS` and `EXT_FORMAT` in
`extract_cases.js`. Tabular formats should reuse `gridToFeature()` so they inherit header
detection and repeated-header handling for free.

Add tests to `tests/extract_cases.test.js` and run:

```bash
npm test
```
