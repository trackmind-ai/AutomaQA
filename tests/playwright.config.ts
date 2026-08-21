import { defineConfig } from '@playwright/test';

/**
 * Config for the plugin's OWN test suite — it verifies the shipped templates
 * (healing-locator, flake-store) behave as documented.
 *
 * This is NOT the config users get; that template lives in
 * plugins/automaqa/templates/playwright.config.ts.
 *
 * Run: npx playwright test --config tests/playwright.config.ts
 */
export default defineConfig({
  testDir: '.',
  maxFailures: 0,
  retries: 0,          // these tests must be deterministic; a retry would mask a bug
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  use: { headless: true },
});
