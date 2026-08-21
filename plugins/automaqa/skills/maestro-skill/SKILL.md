---
description: Maestro YAML coding standards for writing robust, maintainable mobile E2E flows. Invoked by automaqa:maestro-e2e at Step 5.
when_to_use: Use when writing Maestro YAML flow files, choosing mobile locators, structuring mobile test cases, or handling gestures. Do not invoke standalone — always have live screen inspection results ready first.
disable-model-invocation: true
---

# Maestro Flow Writing Standards

> This skill is a coding reference. It is invoked by `automaqa:maestro-e2e` at Step 5 — not triggered directly by the user. Always have spec-derived test scenarios and a live screen inspection ready before writing YAML.

Technical rules for writing robust, clean, and maintainable Maestro `.yaml` mobile E2E test flows.

---

## Core Commands and Syntax

A Maestro flow starts with the target App ID, followed by sequential actions:

```yaml
appId: com.example.app
---
- launchApp:
    clearState: true
- tapOn: "Sign In"
- tapOn:
    id: "email"
- inputText: ${CLIENT_EMAIL}
- tapOn:
    id: "password"
- inputText: ${CLIENT_PASSWORD}
- hideKeyboard
- tapOn: "Login"
- assertVisible: "Dashboard"
```

---

## Locator Rules

Always prefer visible text or accessibility IDs over coordinates:

- **By text**: `tapOn: "Sign In"`
- **By accessibility ID**:
  ```yaml
  - tapOn:
      id: "login_button"
  ```
- **Combined text + ID** (most robust):
  ```yaml
  - tapOn:
      text: "Submit"
      id: "btn_submit"
  ```
- **Never use hardcoded coordinates** unless no other locator exists and screen inspection confirms it.

---

## Assertions and Waiting

Never use hardcoded sleeps (`- delay`). Use auto-waiting assertions:

- **Standard**: `- assertVisible: "Dashboard"`
- **Extended** (slow network loads, up to 30 seconds):
  ```yaml
  - assertVisible:
      id: "dashboard_container"
      extendedWait: true
  ```
- **Assert not visible** (verify element is gone after action):
  ```yaml
  - assertNotVisible: "Error message text"
  ```
- **Assert element contains text**:
  ```yaml
  - assertVisible:
      text: "Welcome"
  ```

---

## Negative Testing Patterns

For adversarial scenarios derived from the spec, use these YAML patterns:

**Submit empty required field and assert error:**
```yaml
- tapOn: "Submit"
- assertVisible: "This field is required"
```

**Input that violates the spec's format rule and assert rejection:**
```yaml
- tapOn:
    id: "email_field"
- inputText: "not-an-email"
- tapOn: "Submit"
- assertVisible: "Enter a valid email"
```

**Input at the boundary the spec defines as invalid:**
```yaml
- tapOn:
    id: "name_field"
- inputText: ""
- tapOn: "Submit"
- assertVisible: "Name is required"
```

**Verify app does not proceed past a screen when validation fails:**
```yaml
- tapOn: "Next"
- assertVisible: "Step 1 Title"
- assertNotVisible: "Step 2 Title"
```

**Back navigation and state reset:**
```yaml
- tapOn: "Back"
- assertVisible: "Previous Screen Title"
- tapOn: "Next"
- assertVisible: "Current Screen Title"
```

---

## Gestures

- **Scroll down**: `- scroll`
- **Swipe left**:
  ```yaml
  - swipe:
      direction: LEFT
  ```
- **Swipe right**:
  ```yaml
  - swipe:
      direction: RIGHT
  ```
- **Clear focused input**: `- clearText`
- **Hide keyboard**: `- hideKeyboard`

---

## Reusable Subflows

Break complex flows into reusable subflows:

```yaml
- runFlow: subflows/login.yaml
```

With parameters:
```yaml
- runFlow:
    file: subflows/login.yaml
    env:
      EMAIL: ${CLIENT_EMAIL}
      PASSWORD: ${CLIENT_PASSWORD}
```

---

## Dynamic Parameterization

Never hardcode credentials inside YAML files. Use Maestro's `-e` flag to pass them at runtime — values come from the credentials the user provided at the start of the test session (collected by `automaqa:playwright-e2e` Step 0 or by `automaqa:maestro-e2e` if invoked standalone).

YAML file — uses variables, not literals:
```yaml
appId: com.example.app
---
- launchApp:
    clearState: true
- tapOn:
    id: "email"
- inputText: ${CLIENT_EMAIL}
- tapOn:
    id: "password"
- inputText: ${CLIENT_PASSWORD}
- hideKeyboard
- tapOn:
    id: "btn-login"
```

Run command — credentials supplied inline, not from a file:
```bash
maestro test -e CLIENT_EMAIL="user@test.com" -e CLIENT_PASSWORD="pass123" flows/login.yaml
```

---

## WebView / Flutter Keyboard Rule

In Flutter apps where Auth0 or other login screens load in a Custom Tab or WebView container, the Android virtual keyboard stays active after password entry and covers buttons. Always dismiss it before tapping submit:

```yaml
- tapOn:
    id: "password"
- inputText: ${CLIENT_PASSWORD}
- hideKeyboard
- tapOn:
    id: "btn-login"
```

> Note: this pattern also applies to any password manager or biometric prompt overlay — dismiss them before asserting the next screen.

---

## CLI Reference

```bash
# Run a single flow
maestro test flows/login.yaml

# Run with variables
maestro test -e EMAIL=user@test.com -e PASSWORD=pass123 flows/login.yaml

# Inspect current screen hierarchy
maestro hierarchy

# Run all flows in a directory
maestro test flows/
```

---

## Test Case Coverage Per Screen (~20 Cases)

When writing the flow's test scenarios, derive all cases from the spec. Structure them as:

**Happy path (20-30%):**
- The exact interaction the spec describes as correct
- Valid inputs at the boundaries the spec defines

**Negative and adversarial (70-80%):**
- Empty required fields, one at a time
- Inputs violating each validation rule the spec defines
- Wrong data type or format per spec
- Attempting to proceed past a step that should block
- Back navigation and re-submission with different data
- Session/state issues: relaunch mid-flow, re-enter after error

Write each scenario as its own discrete test or clearly separated block within the YAML. Each must have a corresponding assertion that confirms the correct spec-defined outcome.
