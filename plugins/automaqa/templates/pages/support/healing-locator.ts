/**
 * healing-locator.ts
 * ──────────────────
 * Self-healing element resolution for Playwright page objects.
 *
 * Tries a ranked list of candidate locators and returns the first that resolves to
 * EXACTLY ONE element. A candidate matching several elements is skipped, never
 * guessed at: picking one arbitrarily can make a test assert against the wrong
 * element and pass, which is worse than a red test.
 *
 * Use this ONLY where locating an element is a precondition of the test. Never use
 * it in negative assertions (`toBeHidden`, permission checks, empty states) — there,
 * the element's absence is the thing being verified.
 *
 * See the `automaqa:self-healing` skill for the candidate ladder and policy.
 */

import { type Page, type Locator } from '@playwright/test';

export interface Candidate {
  /** Human-readable description of this strategy; appears in heal reports. */
  readonly label: string;
  /** How this candidate finds the element. */
  readonly find: (page: Page) => Locator;
}

export interface HealEvent {
  /** The element's role in the test, e.g. "Login submit button". */
  element: string;
  /** The candidate that actually worked. */
  usedLabel: string;
  /** 1-based position of the working candidate in the ladder. */
  usedRank: number;
  /** The preferred candidate that failed. */
  primaryLabel: string;
  /** Page URL at heal time, for debugging. */
  url: string;
}

/**
 * Heals recorded during this run. The versioned reporter renders these into the
 * HTML report so drift is visible rather than silently absorbed.
 */
export const healEvents: HealEvent[] = [];

/** Clear recorded heals. Useful between suites in long sessions. */
export function resetHealEvents(): void {
  healEvents.length = 0;
}

/** True when any element needed a fallback during this run. */
export function didHeal(): boolean {
  return healEvents.length > 0;
}

/**
 * Resolve `element` by trying `candidates` in order, most-stable first.
 *
 * @param page       The Playwright page.
 * @param element    What this element is, in plain words, for the report.
 * @param candidates Ranked strategies. `candidates[0]` is the preferred locator.
 * @param timeoutMs  Total budget, divided across candidates. Default 5000.
 *
 * @returns A locator guaranteed to match exactly one element.
 * @throws  If no candidate resolves unambiguously — the element is genuinely gone
 *          (a real bug) or every candidate is stale (fix the page object).
 */
export async function heal(
  page: Page,
  element: string,
  candidates: Candidate[],
  timeoutMs = 5_000,
): Promise<Locator> {
  if (!candidates.length) {
    throw new Error(`heal("${element}"): no candidates supplied`);
  }

  const attempts: string[] = [];
  const perCandidate = Math.max(500, Math.floor(timeoutMs / candidates.length));

  for (let i = 0; i < candidates.length; i++) {
    const { find, label } = candidates[i];

    let locator: Locator;
    try {
      locator = find(page);
    } catch (err) {
      attempts.push(`${label}: invalid locator (${(err as Error).message})`);
      continue;
    }

    try {
      await locator.first().waitFor({ state: 'attached', timeout: perCandidate });
    } catch {
      attempts.push(`${label}: no match`);
      continue;
    }

    // Insist on a unique match. Ambiguity is failure, not an invitation to guess.
    const count = await locator.count();
    if (count !== 1) {
      attempts.push(`${label}: ambiguous (${count} matches) — refusing to guess`);
      continue;
    }

    if (i > 0) {
      const event: HealEvent = {
        element,
        usedLabel: label,
        usedRank: i + 1,
        primaryLabel: candidates[0].label,
        url: page.url(),
      };
      healEvents.push(event);
      process.stderr.write(
        `  [HEAL] "${element}" — primary "${event.primaryLabel}" failed; ` +
        `used fallback #${event.usedRank} "${event.usedLabel}". Update the page object.\n`,
      );
    }

    return locator;
  }

  throw new Error(
    `heal("${element}"): no candidate resolved to exactly one element.\n` +
    attempts.map(a => `    - ${a}`).join('\n') +
    `\n  URL: ${page.url()}\n` +
    '  Either the element is genuinely gone (a real bug — report it) or every ' +
    'candidate is stale (fix the page object).',
  );
}

/**
 * Render the heal summary as plain text. The reporter embeds this in the HTML
 * report; it is also useful for CI logs.
 */
export function formatHealSummary(events: HealEvent[] = healEvents): string {
  if (!events.length) return '';

  const lines = [
    `Self-healing summary — ${events.length} element(s) healed`,
    '─'.repeat(60),
  ];
  for (const e of events) {
    lines.push(`${e.element}`);
    lines.push(`  primary (failed): ${e.primaryLabel}`);
    lines.push(`  used instead:     ${e.usedLabel}  (rank ${e.usedRank})`);
    lines.push(`  url:              ${e.url}`);
  }
  lines.push('');
  lines.push('These tests passed using fallbacks. The primary locators are stale —');
  lines.push('update the page objects before the fallbacks drift too.');
  return lines.join('\n');
}
