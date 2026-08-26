#!/usr/bin/env bash
# Repository self-check. Run before opening a pull request.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

FAIL=0
pass() { printf '  [OK]   %s\n' "$1"; }
fail() { printf '  [FAIL] %s\n' "$1"; FAIL=1; }

# Browser-backed tests of the shipped templates. Needs a real Chromium, so the
# caller checks for one first and skips rather than reporting a false failure.
run_template_tests() {
  if npx --no-install playwright test --config tests/playwright.config.ts >/dev/null 2>&1; then
    pass "tests/playwright.config.ts"
  else
    npx --no-install playwright test --config tests/playwright.config.ts 2>&1 | tail -15 | sed 's/^/         /'
    fail "template behaviour tests failed"
  fi
  rm -rf test-results
}

echo "==> Manifests parse as JSON"
for f in .claude-plugin/marketplace.json plugins/automaqa/.claude-plugin/plugin.json plugins/automaqa/hooks/hooks.json; do
  if [ ! -f "$f" ]; then fail "$f missing"; continue; fi
  if node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" 2>/dev/null; then
    pass "$f"
  else
    fail "$f is not valid JSON"
  fi
done

echo "==> Every skill has required frontmatter"
for d in plugins/automaqa/skills/*/; do
  f="$d/SKILL.md"
  name=$(basename "$d")
  if [ ! -f "$f" ]; then fail "$name has no SKILL.md"; continue; fi
  head -1 "$f" | grep -q '^---$' || { fail "$name: frontmatter must start on line 1"; continue; }
  grep -q '^description:' "$f" || { fail "$name: missing description"; continue; }
  grep -q '^when_to_use:' "$f" || { fail "$name: missing when_to_use"; continue; }
  pass "$name"
done

echo "==> Agents have frontmatter"
for f in plugins/automaqa/agents/*.md; do
  name=$(basename "$f")
  if grep -q '^name:' "$f" && grep -q '^description:' "$f"; then pass "$name"; else fail "$name: missing name/description"; fi
done

echo "==> Node scripts parse"
for f in plugins/automaqa/scripts/pipeline/*.js plugins/automaqa/scripts/hooks/*.js; do
  if node --check "$f" 2>/dev/null; then pass "$(basename "$f")"; else fail "$(basename "$f") has a syntax error"; fi
done

echo "==> Shell scripts parse"
for f in scripts/*.sh; do
  if bash -n "$f" 2>/dev/null; then pass "$(basename "$f")"; else fail "$(basename "$f") has a syntax error"; fi
done

echo "==> No stale plugin paths or old namespace"
if grep -rn --include='*.md' --include='*.json' --include='*.js' -e 'bin/pipeline' -e 'bin/hooks' -e '/Testing:' -e 'extract_excel' plugins/ 2>/dev/null | grep -v Binary; then
  fail "stale references found above"
else
  pass "no stale references"
fi

echo "==> CODEOWNERS paths exist"
if [ -f .github/CODEOWNERS ]; then
  co_fail=0
  while IFS= read -r line; do
    # Skip blank lines and comments.
    case "$line" in ''|'#'*) continue ;; esac
    p="${line%% *}"
    # Paths are repo-root-relative with a leading '/'; strip it so -e checks
    # against the current directory (validate.sh has already cd'd to repo root),
    # not the filesystem root. A trailing slash means "directory" and -e handles that fine.
    check="${p#/}"
    if [ ! -e "$check" ]; then
      fail "CODEOWNERS references '$p', which does not exist in the repo"
      co_fail=1
    fi
  done < .github/CODEOWNERS
  [ "$co_fail" -eq 0 ] && pass ".github/CODEOWNERS"
else
  fail ".github/CODEOWNERS is missing"
fi

echo "==> No sample or generated content committed"
for p in plugins/automaqa/tests/e2e plugins/automaqa/specs test-results specs; do
  if [ -e "$p" ]; then fail "$p should not exist in the repo"; else pass "$p absent"; fi
done
echo "==> Shipped templates present"
for f in plugins/automaqa/templates/playwright.config.ts plugins/automaqa/templates/tests/versioned-reporter.ts plugins/automaqa/templates/pages/support/healing-locator.ts plugins/automaqa/templates/tests/support/flake-store.ts plugins/automaqa/templates/tests/support/quarantine.ts; do
  if [ -f "$f" ]; then pass "$(basename "$f")"; else fail "$f is missing - setup copies it into the user project"; fi
done

echo "==> TypeScript templates typecheck"
if [ -f node_modules/typescript/package.json ]; then
  if npx --no-install tsc --noEmit -p tsconfig.json >/dev/null 2>&1; then
    pass "tsc --noEmit"
  else
    npx --no-install tsc --noEmit -p tsconfig.json 2>&1 | head -10 | sed 's/^/         /'
    fail "TypeScript templates do not typecheck"
  fi
else
  echo "  [SKIP] typescript not installed (run npm install)"
fi

echo "==> Intake parser unit tests"
if node tests/extract_cases.test.js >/dev/null 2>&1; then
  pass "extract_cases.test.js"
else
  node tests/extract_cases.test.js 2>&1 | tail -12 | sed 's/^/         /'
  fail "intake parser tests failed"
fi

echo "==> Hook notifier unit tests"
if node tests/hook.test.js >/dev/null 2>&1; then
  pass "hook.test.js"
else
  node tests/hook.test.js 2>&1 | tail -12 | sed 's/^/         /'
  fail "hook notifier tests failed"
fi

echo "==> Template behaviour tests (flake-store, healing-locator)"
if [ ! -d node_modules/@playwright/test ]; then
  echo "  [SKIP] @playwright/test not installed (run: npm install)"
elif ! node -e "const{chromium}=require('@playwright/test');process.exit(require('fs').existsSync(chromium.executablePath())?0:1)" 2>/dev/null; then
  echo "  [SKIP] Chromium not installed (run: npx playwright install chromium)"
else
  run_template_tests
fi

echo "==> SAMPLE.md code examples"
if [ -d node_modules/typescript ]; then
  if bash tests/docs/verify-sample.sh >/dev/null 2>&1; then
    pass "SAMPLE.md examples compile and contain no leaked locators"
  else
    bash tests/docs/verify-sample.sh 2>&1 | tail -12 | sed 's/^/         /'
    fail "SAMPLE.md verification failed"
  fi
else
  echo "  [SKIP] typescript not installed (run npm install)"
fi

echo "==> Repo is clean enough to publish"
# Local Claude state carries machine-specific absolute paths.
if [ -e .claude/settings.local.json ]; then fail ".claude/settings.local.json must not be committed"; else pass "no local Claude settings"; fi
# Absolute developer paths anywhere in tracked text.
if grep -rnE 'C:\\Users|/c/Users|OneDrive' --include='*.md' --include='*.json' --include='*.sh' --include='*.ps1' --include='*.yml' --include='*.ts' --include='*.js' . 2>/dev/null | grep -v node_modules | grep -q .; then
  fail "absolute developer paths found"
else
  pass "no absolute developer paths"
fi
# Git cannot track empty directories.
if find . -path ./node_modules -prune -o -path ./.git -prune -o -type d -empty -print 2>/dev/null | grep -q .; then
  find . -path ./node_modules -prune -o -path ./.git -prune -o -type d -empty -print | sed 's/^/         /'
  fail "empty directories cannot be committed"
else
  pass "no empty directories"
fi
# Workbooks and generated output must never be tracked.
if find . -path ./node_modules -prune -o -path ./.git -prune -o \( -name '*.xlsx' -o -name '*.xls' \) -print 2>/dev/null | grep -q .; then
  fail "spreadsheet workbooks present"
else
  pass "no spreadsheet workbooks"
fi
if find . -path ./node_modules -prune -o -path ./.git -prune -o -type f -size +1M -print 2>/dev/null | grep -q .; then
  find . -path ./node_modules -prune -o -path ./.git -prune -o -type f -size +1M -print | sed 's/^/         /'
  fail "files larger than 1MB present"
else
  pass "no oversized files"
fi

echo
if [ "$FAIL" -eq 0 ]; then echo "All checks passed."; else echo "Some checks failed."; fi
exit "$FAIL"
