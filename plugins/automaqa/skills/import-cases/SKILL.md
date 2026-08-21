---
description: Convert test cases from any format — Excel, CSV/TSV, JSON, Markdown, Gherkin, YAML, XML or plain text — into structured spec.md files following the 9-section spec format. Supports web (Playwright) and mobile (Maestro).
when_to_use: Use when the user provides test cases in any file format and wants spec.md files generated. Trigger on "generate spec", "import test cases", "convert test cases", "excel to spec", "csv to spec", "build spec from", or any .xlsx/.csv/.json/.md/.feature/.yaml/.xml/.txt path mentioned alongside "spec" or "test cases".
argument-hint: [path/to/TestCases.(xlsx|csv|json|md|feature|yaml|xml|txt)]
---

# Test-Case Import

Converts test cases in **whatever format the tester has** into production-ready `spec.md`
files that feed directly into the `automaqa:playwright-e2e` and `automaqa:maestro-e2e` skills.

**Claude writes every spec.md directly using the Write tool — no script is used to build specs.**
The single extraction step uses `node extract_cases.js`, which auto-detects the format.

## Supported input formats

| Format | Extensions | How it is read |
|---|---|---|
| Excel | `.xlsx` `.xlsm` `.xls` | One feature per sheet |
| Delimited | `.csv` `.tsv` | Delimiter auto-detected (comma, tab, semicolon, pipe) |
| JSON | `.json` | Array, `{test_cases}`, `{features}`, or a Zephyr/TestRail/Xray export |
| Markdown | `.md` | GFM tables (one feature per heading), or headings + `Steps:`/`Expected:` prose |
| Gherkin | `.feature` | Scenario / Scenario Outline; Given→precondition, When→steps, Then→expected |
| YAML | `.yaml` `.yml` | A case list or `{features: [...]}` |
| XML | `.xml` | TestRail / Xray / generic `<testcase>` elements |
| Plain text | `.txt` | Numbered or bulleted case lists |

Detection is by extension, falling back to content sniffing — so a file with no
extension, or one named `.txt` that is really CSV, still works. If detection guesses
wrong, pass `--format=<fmt>` to force a parser.

**Never transcribe cases by hand.** Always run the extractor: hand-copying loses rows
silently, and the extractor reports exactly what it collected and skipped.

## Where This Skill Fits

```
automaqa:import-cases   <-- YOU ARE HERE
        |
        v
  specs/<feature>/spec.md   (reviewed and approved by user)
        |
        v
automaqa:playwright-e2e  -->  reads spec.md --> writes Playwright tests
        |
        v
automaqa:maestro-e2e     -->  reads spec.md --> writes Maestro YAML (mobile)
```

**Important:** Automation is triggered **automatically** the moment the user approves the specs.
As soon as the user says approve, invoke the appropriate skill immediately — do not wait for further input.

---

## Step-by-Step Execution

### Step 0: Create a Task List

Before doing anything else, use TaskCreate to create a task list with these items:
1. Collect inputs (source file path, platform, environment details)
2. Verify the runtime for the detected format
3. Run the extractor and reconcile the case count
4. Build spec.md files with Write tool
5. Present specs to user for review
6. Apply requested changes and loop until user approves

Use TaskUpdate to mark each item **in_progress** when starting and **completed** when done.

---

### Step 1: Collect Inputs

Ask the user (or infer from context) these things:

| Input | How to get it |
|---|---|
| **Source file path** | User provides it, or look for a test-case file in the message (`.xlsx` `.csv` `.json` `.md` `.feature` `.yaml` `.xml` `.txt`) |
| **Platform** | Ask: *"Is this for web, mobile, or both?"* Default: `both` |
| **Environment details** | Ask the user directly — see below |

**Ask the user for environment details in chat:**

> "Before I build the specs, please share the environment details for the Environment section:
> - Base URL (e.g. `https://app.example.com`)
> - Login email / username (or describe how it's provided, e.g. 'provided at test run')
> - Login password (or 'provided at test run')
> - Any account state or preconditions needed before testing starts
>
> If you're unsure, just say 'skip' and I'll leave the Environment section blank for you to fill in later."

Store whatever the user provides. If they say skip, leave Environment as a placeholder.

---

### Step 2: Verify the runtime for the detected format

Only Excel needs a package. Everything else uses the Node standard library.

**If the file is `.xlsx`, `.xlsm` or `.xls`:**
```bash
node -e "require('xlsx'); console.log('xlsx OK')"
```
If it fails, run `npm install` in the user's project directory (or `npm install xlsx`).

**For every other format:** no check needed — proceed.

If Node.js is not installed at all, tell the user to run `/automaqa:setup` first.

---

### Step 3: Extract to JSON and reconcile the count

The extractor auto-detects the format and maps each source column or field onto the
canonical set: `id`, `type`, `scenario`, `steps`, `expected`, `precondition`,
`test_data`. Columns it does not recognise — `Actual Result`, `Status`, `Comments`,
`Tester` — are deliberately ignored, so a run log never contaminates the spec.

**Windows & Mac/Linux (same):**
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/pipeline/extract_cases.js" "<source_path>" "specs/raw_test_cases.json" --verbose
```

- `${CLAUDE_PLUGIN_ROOT}` — resolves to the plugin's directory automatically
- `<source_path>` — the full path to the test-case file
- `--verbose` — prints which format was detected, which header row was used, which
  columns were ignored, and which rows were skipped. **Always pass it**: this output is
  how you prove nothing was collected wrongly.

Add `--format=<fmt>` only if detection picked the wrong parser
(`xlsx` `csv` `json` `markdown` `gherkin` `yaml` `xml` `text`).

**Reconcile before continuing — this is a hard gate.**

Read `specs/raw_test_cases.json` and report to the user:

- the detected format
- each feature's name and case count
- the total case count
- anything the extractor skipped (rows above the header, repeated headers, blank rows)
- any `warnings` present in the output

Then compare against the source. **If the tester says the file has 40 cases and the
extractor found 37, stop and resolve the difference before building any spec.** Silent
row loss is the single worst failure in test-case intake: the missing cases look tested
when they were never imported.

Common causes of a mismatch:

| Symptom | Cause | Fix |
|---|---|---|
| Far too few cases | Wrong header row picked | Check the `--verbose` header line; force `--format` or clean the file |
| One case per sheet | Merged cells in the source | Ask the tester to unmerge, or handle those rows manually |
| Cases with empty scenarios | Source has no title column | Confirm which column holds the case name |
| Extra junk cases | Trailing notes rows below the table | Confirm with the tester, then ignore them |

**If the extractor exits with an error, report it verbatim and stop.** Never fall back
to transcribing cases by hand.

---

### Step 4: Build Spec Files with the Write Tool

**Do NOT run any Python script to build specs. Claude writes every spec.md directly.**

For each feature in `raw_test_cases.json`:

1. Create the output directory: `specs/<feature-slug>/`
2. Build the spec content in memory following the 9-section format below
3. Write it with the Write tool to `specs/<feature-slug>/spec.md`

#### How to slug the feature name
Lowercase, replace spaces with hyphens, strip special characters.
Example: `"My Day Filter"` → `my-day-filter`

---

#### Spec format to generate

Use the environment details the user provided in Step 1. If they said skip, use placeholder text.

```markdown
# <Feature Name> — Test Spec

## Environment

| Key | Value |
|---|---|
| Base URL | <url from user, or "(provided at test run start)"> |
| Login email | <email from user, or "(provided at test run start)"> |
| Login password | <password from user, or "(provided at test run start)"> |
| Account state | <account state from user, or "(provided at test run start)"> |

---

## Feature Overview

<Write 2–4 sentences summarising what this feature does, based on the imported test scenarios.>

---

## Entity States

<Only include this section if the feature has objects that change status over time (e.g. uploads, bookings, approvals).
If not applicable, omit this section entirely.>

| State | What the User Sees | Triggered By |
|---|---|---|
| ... | ... | ... |

---

## Field Contracts

<Only include this section if the feature has input fields.
Derive field names from the Test Scenario / Test Steps / Test Data columns.
If not applicable, omit this section entirely.>

| Field | Required | Type | Min | Max | Format / Allowed Values |
|---|---|---|---|---|---|
| ... | ... | ... | ... | ... | ... |

---

## UI Reference

<List every button, label, toast, and error message that appears in the Expected Result column.
Extract quoted strings directly — do not invent text.>

| Element | Exact Label / Text |
|---|---|
| ... | ... |

---

## Data Prerequisites

<List what must exist in the system before tests run. Derive from the Pre-Condition column.>

- <precondition 1>
- <precondition 2>

---

## Happy Path

<Number the steps for the primary positive test case. Use the first Positive/Functional Positive row's Test Steps.>

1. ...
2. ...

---

## Test Cases

<Group test cases by Test Type (e.g. Functional Positive, Functional Negative, Edge Case).
Use ALL cases from the source — one source case = one test case entry.
Columns to use: TC ID → ID, Test Scenario → Description, Test Steps → Steps, Test Data → Test Data, Expected Result → Expected Result.>

### <Test Type Group 1>

| ID | Description | Steps | Test Data | Expected Result |
|---|---|---|---|---|
| <TC ID> | <Test Scenario> | <Test Steps> | <Test Data> | <Expected Result> |
...

### <Test Type Group 2>

| ID | Description | Steps | Test Data | Expected Result |
|---|---|---|---|---|
...

---

## Acceptance Criteria

<Derive from the Expected Result column. One row per distinct expected outcome.
Write as "what the UI shows" — no backend language, no status codes.>

| Scenario | What the UI Should Show |
|---|---|
| ... | ... |
```

**Rules while writing:**
- Every imported test case must appear in the Test Cases section — no cases skipped
- Group rows by their Test Type column value (create a `###` heading per unique type)
- Extract UI strings from Expected Result exactly as written — do not paraphrase
- For Entity States and Field Contracts: include only if the data supports it; omit if not applicable
- For Environment: use exactly what the user provided in Step 1; never invent URLs or credentials

---

### Step 5: Present Specs to User for Review

**This step is mandatory. Do not proceed to automation until the user explicitly approves.**

For each generated spec, display its full content inline in your response:

```
================================================================================
SPEC REVIEW — <Feature Name>
Path: specs/<feature>/spec.md
================================================================================

<paste the full content of spec.md here>

================================================================================
```

After displaying all specs, post this exact prompt:

---

**Spec Review**

I've generated the spec files above. Please review them carefully.

- If everything looks correct, reply **"approve"** and I will **immediately start testing** — no further steps needed.
- If you want changes, describe what needs to be different and I will update the specs and show them again.

---

### Step 6: Apply Changes and Loop Until Approved

Read the user's reply:

**If the user says approve / looks good / proceed / yes / LGTM (or any clear affirmation):**
- Mark the task as approved
- Print the final summary (see Step 7 below)
- **Immediately invoke the appropriate skill** — do not wait, do not ask again

**If the user requests changes:**
1. Apply every requested change using the Edit tool directly on the relevant `spec.md` file(s)
2. Read the updated file(s) and display the changed sections inline so the user can verify the edits
3. Ask again:

   > "I've applied your changes above. Do you approve the specs now, or would you like further adjustments?"

4. Repeat this loop until the user explicitly approves.

**Never invoke testing skills before the user approves. Once they approve — invoke immediately.**

---

### Step 7: Auto-Invoke Testing Skill After Approval

Print this summary, then **immediately call the Skill tool** for the appropriate platform.

**If platform = `web`:** call `Skill({ skill: "automaqa:playwright-e2e" })`

```
Specs approved — starting Playwright tests now.
----------------------------------------
Features processed : N
Output directory   : specs/
Platform           : Web (Playwright)

Approved specs:
  [OK] <feature>  ->  specs/<feature>/spec.md  (N TCs)

Handing off to → automaqa:playwright-e2e
```

**If platform = `mobile`:** call `Skill({ skill: "automaqa:maestro-e2e" })`

```
Specs approved — starting Maestro tests now.
----------------------------------------
Features processed : N
Output directory   : specs/
Platform           : Mobile (Maestro)

Approved specs:
  [OK] <feature>  ->  specs/<feature>/spec.md  (N TCs)

Handing off to → automaqa:maestro-e2e
```

**If platform = `both`:** call `Skill({ skill: "automaqa:playwright-e2e" })` (playwright-e2e internally triggers maestro-e2e)

```
Specs approved — starting Web + Mobile tests now.
----------------------------------------
Features processed : N
Output directory   : specs/
Platform           : Web (Playwright) + Mobile (Maestro)

Approved specs:
  [OK] <feature>  ->  specs/<feature>/spec.md  (N TCs)

Handing off to → automaqa:playwright-e2e (Maestro parity included)
```

---

## Field Mapping

Only these columns are extracted (anything after Expected Result is ignored):

| Source column / field | Canonical Key | Spec Section |
|---|---|---|
| TC ID | `id` | Test Cases → ID |
| Test Scenario | `scenario` | Test Cases → Description + Feature Overview |
| Test Type | `type` | Test Cases → group heading (### heading) |
| Pre-Condition | `precondition` | Data Prerequisites |
| Test Data | `test_data` | Test Cases → Test Data |
| Test Steps | `steps` | Happy Path + Test Cases → Steps |
| Expected Result | `expected` | Test Cases → Expected Result + Acceptance Criteria |

**Never extracted:** `Actual Result`, `Status`, `Pass/Fail`, `Comments`, `Notes`,
`Remarks`, `Tester`, `Executed On`. These record a *past run*, not the specification.
Importing them would bake one run's outcome into the spec.

The extractor recognises many synonyms per field, so exports from Jira, Zephyr, TestRail
and Xray map without renaming columns — `Key`→id, `Summary`→scenario,
`Preconditions`→precondition, `Test Procedure`→steps,
`Acceptance Criteria`→expected. If a column is not recognised, `--verbose` names it as
ignored; if it matters, tell the user rather than silently dropping it.

---

## Strict Rules

1. Never write spec content from memory — every test case must trace back to a row in the source file
2. Never use any script to build spec.md files — Claude writes them directly with the Write tool
3. Always ask the user for environment details before building specs
4. Never proceed to automation BEFORE approval — but immediately invoke the testing skill AFTER approval
5. Always use the Write tool to create spec.md and the Edit tool to modify them
6. Always show the full spec content for review before asking for approval
7. Always ask for the platform if not obvious
8. Always loop on Step 6 until the user gives explicit approval — do not assume silence means approval
9. Every case in the source must appear in the spec — no rows skipped or merged
10. Always reconcile the extracted count against the source before building specs (Step 3).
    A count mismatch is a blocking problem, not a rounding error
11. Never hand-transcribe cases when the extractor fails — fix the input or report the error
