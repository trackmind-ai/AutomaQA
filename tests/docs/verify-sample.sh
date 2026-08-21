#!/usr/bin/env bash
# Verifies the code examples in SAMPLE.md actually compile against the shipped
# templates, and that the documented spec file really contains no locators.
# A walkthrough with broken code is worse than no walkthrough.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1

WORK=".tmp-sample-verify"
rm -rf "$WORK"
mkdir -p "$WORK/pages/support" "$WORK/tests/support" "$WORK/tests/e2e"

cp plugins/automaqa/templates/pages/support/healing-locator.ts "$WORK/pages/support/"
cp plugins/automaqa/templates/tests/support/flake-store.ts     "$WORK/tests/support/"
cp plugins/automaqa/templates/tests/support/quarantine.ts      "$WORK/tests/support/"

# base.page.ts is documented in the page-objects skill, not SAMPLE.md.
cat > "$WORK/pages/base.page.ts" <<'EOF'
import { type Page } from '@playwright/test';
export abstract class BasePage {
  constructor(protected readonly page: Page) {}
  abstract waitUntilReady(): Promise<void>;
}
EOF

cat > "$WORK/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022", "module": "preserve", "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM"], "types": ["node"],
    "strict": true, "noEmit": true, "skipLibCheck": true
  },
  "include": ["pages/**/*.ts", "tests/**/*.ts"]
}
EOF

FAIL=0
node tests/docs/extract-sample-code.js "$WORK" || FAIL=1

if npx --no-install tsc --noEmit -p "$WORK/tsconfig.json"; then
  echo "  [OK]   SAMPLE.md examples typecheck"
else
  echo "  [FAIL] SAMPLE.md examples do not compile"
  FAIL=1
fi

if grep -rqn "getByRole\|getByLabel\|getByTestId\|locator(" "$WORK/tests/e2e/"; then
  echo "  [FAIL] the documented spec file contains a locator - it must contain none"
  grep -rn "getByRole\|getByLabel\|getByTestId\|locator(" "$WORK/tests/e2e/"
  FAIL=1
else
  echo "  [OK]   documented spec file contains no locators"
fi

rm -rf "$WORK"
exit "$FAIL"
