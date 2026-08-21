---
description: Universal autonomous workflow for writing and verifying E2E Maestro mobile tests using screen inspection. Works standalone for mobile-only testing or is invoked by automaqa:playwright-e2e for cross-platform parity.
when_to_use: Use when the user wants to run mobile E2E tests, write Maestro YAML flows, test a mobile feature, verify mobile behavior from a spec, or do mobile-only testing without Playwright. Trigger on "run mobile tests", "test mobile", "write maestro flows", "maestro e2e", "test on device", "mobile testing", "run on emulator", or when the user mentions testing on Android or iOS.
argument-hint: [feature-name or spec-path]
---

# Maestro E2E Workflow

Iterative, screen-by-screen visual loop for developing and verifying mobile E2E flows.

This skill works in two modes:
- **Standalone** — user invokes it directly for mobile-only testing. Collects credentials in Step 0.
- **Orchestrated** — invoked by `automaqa:playwright-e2e` for cross-platform steps. Credentials are already in context from playwright-e2e Step 0 — skip Step 0 in that case.

Follow these steps exactly for whichever mode applies.

---

## Skill Invocation Map

| Sub-Skill | When to Invoke |
|---|---|
| `automaqa:page-objects` | Step 6 — BEFORE writing flows, to build screen objects under `screens/` |
| `automaqa:self-healing` | Step 6 — when an element id needs a text fallback |
| `automaqa:maestro-skill` | Step 6 — when writing YAML flow code |

---

## Step 0: Confirm Mode and Collect Credentials (Standalone Mode Only)

**Skip this step if invoked from `automaqa:playwright-e2e`** — the mode was already confirmed and credentials are already in context.

If invoked directly by the user, first confirm this is a mobile-only run:

> This skill runs **mobile-only E2E tests** using Maestro. It does not involve Playwright or a browser.
>
> Is this what you want?
> - **Yes, mobile only** → proceed
> - **Web only** → use `/automaqa:playwright-e2e` instead
> - **Both web + mobile** → use `/automaqa:playwright-e2e` instead (it orchestrates mobile internally)

If the user says web or both — stop here and redirect them. Do not continue this skill.

Once confirmed as mobile-only, ask for credentials:

> To run mobile tests I need a few details. Please provide:
> 1. **App ID** — the bundle/package ID of the app (e.g. `com.mycompany.myapp` for Android, `com.mycompany.MyApp` for iOS)
> 2. **Test email** — the login email for the test account
> 3. **Password** — the password for the test account
> 4. **Any additional role accounts** — e.g. admin email/password if the spec has multi-role flows

Wait for the user's reply. Store these values as named variables:
- `APP_ID`
- `TEST_EMAIL`
- `TEST_PASSWORD`
- Any role credentials the user provides

These are passed as inline `-e` flags to `maestro test` commands — never written to a file.

---

## Step 1: Pre-flight Check

**Check that spec.md exists:**

Verify `specs/<feature>/spec.md` exists in the user's cwd (where `<feature>` is the slug of the feature being tested).

If it does not exist, stop and tell the user:
> "No spec found for this feature. Run `/automaqa:import-cases` with platform `mobile` or `both`, review and approve the spec, then re-run this skill."

**Check that Maestro is installed:**

```bash
maestro --version
```

If not installed, tell the user to run `/automaqa:setup` first and stop.

---

## Step 2: Read Specs and Derive the Mobile Test Plan

Read `specs/<feature>/spec.md` and extract the mobile-specific scope:

1. Which flows and screens does the spec describe for mobile?
2. What inputs, gestures, and transitions does the spec define?
3. What validation rules and business logic apply on mobile?
4. What should the app accept, reject, or navigate to per the spec?

From this, build the mobile test plan:
- List every screen in the mobile flow
- For each screen, derive **~20 test scenarios** directly from the spec — both the paths the spec says should work and the ways to break them
- Do not apply a generic checklist; every scenario traces to the spec

---

## Step 3: Get Device and Inspect Current Screen (MANDATORY BEFORE WRITING YAML)

1. Run `mcp_maestro_list_devices` and select the correct `device_id`.

   > **If no devices are listed**, stop immediately and tell the user:
   > "No connected devices or emulators found. Please boot an Android emulator (Android Studio → AVD Manager) or iOS simulator (Xcode → Simulator), or connect a physical device with USB debugging enabled. Then re-run this skill."

2. Run `mcp_maestro_inspect_screen` to get the current screen's view hierarchy — element IDs, accessibility labels, visible text.
3. Run `mcp_maestro_take_screenshot` to visually confirm the screen state.
4. Do not write a single YAML command without first knowing what elements are present on screen.

---

## Step 4: Live Mobile Verification via Maestro MCP (MANDATORY BEFORE WRITING YAML)

For each screen in the flow, complete live verification before writing the YAML flow:

1. Use Maestro MCP tools to manually exercise the screen:
   - `mcp_maestro_run` with inline `yaml` for individual actions (tap, input, swipe, assert)
   - `mcp_maestro_take_screenshot` after each action to confirm state
   - `mcp_maestro_inspect_screen` to re-read hierarchy after state changes
2. Execute the **~20 spec-derived test scenarios** for this screen:
   - Test each input and interaction as the spec defines it
   - For every rule the spec states, test the conforming case and the violating case
   - Test state transitions the spec describes — then attempt ones the spec says should not be possible
   - Test gestures, keyboard dismissal, scroll behavior, and back-navigation
3. Record every deviation from the spec — these are bugs.

> Execute this phase autonomously without stopping for confirmation. Move fast and find bugs.

---

## Step 5: Update HTML Report (Before Writing YAML)

After live mobile verification, before writing the YAML flow:

1. Create or update `specs/<feature>/report.html`.
2. Add a **Mobile — [Screen Name]** section documenting all ~20 scenarios:
   - Scenario ID, description, input, expected behavior (per spec), actual behavior, status (PASS/FAIL/BUG)
   - For BUG: severity, exact reproduction steps, screenshot path
3. Bugs found on mobile are added to the top-level **Bugs Found** section of the report.

---

## Step 6: Write Maestro YAML Flow

**First invoke `automaqa:page-objects`** and create a screen object per screen under
`screens/<name>.screen.yaml`. An element id belongs in exactly one screen file; flows
compose screens with `runFlow` and hold the assertions. Skipping this puts the same id in
five flows, and the next redesign breaks all five.

Where an id may be missing or unstable, invoke **`automaqa:self-healing`** for the
conditional-`runFlow` fallback pattern. Maestro cannot detect ambiguity, so prefer `id`
and treat text fallbacks as strictly temporary — record every fallback used in the report.

Then invoke **`automaqa:maestro-skill`** and follow its coding standards to write the YAML flow:

1. Create the `.yaml` file under `maestro/flows/`.
2. Write the flow screen-by-screen, not all at once.
3. Use `APP_ID` (from Step 0 or passed from playwright-e2e) as the `appId` value.
4. Use parameterized variables for credentials: `${CLIENT_EMAIL}`, `${CLIENT_PASSWORD}`.
5. Use `clearState: true` in `launchApp` to flush stale sessions.
6. Use `hideKeyboard` after password inputs in WebView containers.
7. Use `runFlow` to reference shared subflows (login, setup).

---

## Step 7: Run and Verify the Flow

```bash
maestro test -e CLIENT_EMAIL="<TEST_EMAIL>" -e CLIENT_PASSWORD="<TEST_PASSWORD>" maestro/flows/<feature>.yaml
```

Substitute `<TEST_EMAIL>`, `<TEST_PASSWORD>`, and `<feature>` with actual values from this session.

1. Run the flow and observe the output.
2. If a step fails:
   - Run `mcp_maestro_take_screenshot` to see current screen state
   - Run `mcp_maestro_inspect_screen` to re-read the hierarchy
   - Fix the locator or assertion in the YAML
   - Re-run
3. Repeat the **(Inspect → Update → Run → Verify)** loop until the flow passes.
4. Add any new bugs discovered during the automated run to `report.html`.

---

## Step 8: Iterate Screen-by-Screen

Once the current screen's flow is verified:

1. Inspect the next screen with `mcp_maestro_inspect_screen`.
2. Repeat Steps 4–7 for the next screen.
3. Continue until the full mobile journey is covered.

---

## Step 9: Final Run and Report

1. Run the complete flow end-to-end to confirm stability.
2. Finalize `report.html` with:
   - **Bugs Found** section (top) — every bug with severity, repro steps, screenshot path
   - Summary table: all ~20 scenarios per screen, expected vs actual, status badges
3. **If invoked standalone**: present the final report path and summary to the user.
4. **If invoked from playwright-e2e**: report the mobile test outcome back so it can be included in the consolidated report.

---

## Strict Rules

1. **NO BLIND SCRIPTING**: Never write YAML for a screen without first running `mcp_maestro_inspect_screen` on it.
2. **NO DEVICES = STOP**: If `mcp_maestro_list_devices` returns empty, stop and prompt the user to start a device.
3. **NO HARDCODED SLEEPS**: Never use `- delay`. Use `assertVisible` with `extendedWait: true` for slow loads.
4. **NO GENERIC CASES**: All ~20 scenarios per screen derive from the spec.
5. **NO CREDENTIALS IN YAML**: Credentials go in `-e` flags at run time, not inside the YAML file.
6. **HIDE KEYBOARD**: Always `- hideKeyboard` after inputs in WebView containers before tapping buttons.
7. **COMPLETE FLOWS**: The final YAML must run end-to-end without manual intervention.
