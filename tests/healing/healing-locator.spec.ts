import { test, expect } from '@playwright/test';
import { heal, healEvents, resetHealEvents, formatHealSummary } from '../../plugins/automaqa/templates/pages/support/healing-locator';

const PAGE = `data:text/html,
<button data-testid="ok">Save</button>
<button>Sign in</button>
<div><span>Dup</span><span>Dup</span></div>`;

test.beforeEach(() => resetHealEvents());

test('uses the primary candidate and records no heal', async ({ page }) => {
  await page.goto(PAGE);
  const el = await heal(page, 'Save button', [
    { label: 'testid=ok', find: p => p.getByTestId('ok') },
    { label: 'role=button "Save"', find: p => p.getByRole('button', { name: 'Save' }) },
  ]);
  await expect(el).toBeVisible();
  expect(healEvents).toHaveLength(0);
});

test('falls back and records the heal', async ({ page }) => {
  await page.goto(PAGE);
  const el = await heal(page, 'Login button', [
    { label: 'testid=missing', find: p => p.getByTestId('missing') },
    { label: 'role=button "Sign in"', find: p => p.getByRole('button', { name: 'Sign in' }) },
  ]);
  await expect(el).toBeVisible();
  expect(healEvents).toHaveLength(1);
  expect(healEvents[0].usedRank).toBe(2);
  expect(healEvents[0].primaryLabel).toBe('testid=missing');
  expect(formatHealSummary()).toContain('Login button');
});

test('REFUSES an ambiguous match instead of guessing', async ({ page }) => {
  await page.goto(PAGE);
  await expect(heal(page, 'Dup span', [
    { label: 'text=Dup', find: p => p.getByText('Dup') },
  ], 1500)).rejects.toThrow(/ambiguous \(2 matches\)/);
  expect(healEvents).toHaveLength(0);
});

test('throws with all attempts listed when nothing resolves', async ({ page }) => {
  await page.goto(PAGE);
  await expect(heal(page, 'Ghost', [
    { label: 'testid=nope', find: p => p.getByTestId('nope') },
    { label: 'role=button "Nope"', find: p => p.getByRole('button', { name: 'Nope' }) },
  ], 1500)).rejects.toThrow(/no candidate resolved to exactly one element/);
});

test('skips an ambiguous candidate but still uses a later unique one', async ({ page }) => {
  await page.goto(PAGE);
  const el = await heal(page, 'Mixed', [
    { label: 'text=Dup (ambiguous)', find: p => p.getByText('Dup') },
    { label: 'testid=ok', find: p => p.getByTestId('ok') },
  ], 2000);
  await expect(el).toHaveText('Save');
  expect(healEvents[0].usedRank).toBe(2);
});
