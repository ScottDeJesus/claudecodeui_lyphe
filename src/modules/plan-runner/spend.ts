import type { TFunction } from 'i18next';

/**
 * What a run — or a soul, or a plan — has SPENT, as every card in this app writes it.
 *
 * TWO FIGURES, ONE RULE. Claude work is counted in tokens in and out, never in dollars: the
 * operator's subscription is not a bill, and a card that says `$0.00` over an afternoon of work is
 * worse than one that says nothing (operator rule, 2026-09-24). Dollars are shown only when a
 * PAYING API billed them — DeepSeek is the one this house holds — and then labelled by what was
 * paid (`$0.41 DeepSeek`), so a vendor figure can never be read as a Claude one. A run that rode
 * Claude therefore reads its tokens and no `$` at all.
 *
 * ONE SPELLING, FOUR SCREENS. The run card (`RunFace`), the dispatcher's plan card (`PlanFace`,
 * `PlanPhaseRow`) and the chat strip's launcher-soul pin (`SoulLaunchPinRow`) all draw the same
 * figure from a different record, and each of them feeding its own template literals is how one
 * app ends up saying `$0.41` on one screen and `0.41 USD` on the next. Every one of them comes
 * through here instead, and a change to the wording is a change to this file.
 *
 * THE FIGURES ARE THE RUNNER'S OWN. `cost_usd` is PAID dollars by construction —
 * `hooks/plan_runner/costs.py:result_cost` returns 0 for a child on the Claude subscription — and
 * the tokens are the child's usage, split into what it READ (input + cache read + cache write) and
 * what it wrote. A record written before the split shipped carries the total alone, which reads as
 * the `⛁ n tok` form rather than as `0 in · 0 out`; the split is omitted, the total never is.
 *
 * NOTHING HERE IS TRANSLATED-BY-HAND: the numbers are formatted here, the words come from the
 * caller's `t` (namespace `common`), so the strip and the tab say the same thing in one language.
 */

/**
 * The vendor a `$` figure is labelled by.
 *
 * A product name, not copy, which is why it is a constant and not a translation key: the CLI labels
 * the same figure the same way (`plan_runner/costs.py:PAID_VENDOR`). A second paying API would
 * become a parameter of {@link paidText}, never a second constant.
 */
export const PAID_VENDOR = 'DeepSeek';

/** Byte-for-byte `hooks/plan_runner/costs.py`'s `humanize`: "94.9M", "1M", "12.5k". */
export function humanizeTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 999_950) return `${(n / 1e3).toFixed(1).replace(/\.0$/, '')}k`;   // the same cut
  return `${(n / 1e6).toFixed(1).replace(/\.0$/, '')}M`;
}

/** A count off a JSON record, or `null` — an absent field and a `NaN` are both "not recorded". */
function count(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The paid half: `$0.41 DeepSeek`, or `''` when nothing was billed.
 *
 * The empty string is the rule, not an oversight — a figure of 0 means the work rode Claude, and
 * `$0.00` would read as "this cost nothing" when what it means is "this was not a bill".
 */
export function paidText(t: TFunction, usd: number | null | undefined): string {
  return paidWith(t, usd, 'runner.paid');
}

/**
 * The same figure for a PLAN's total, with the word that says so: `plan $6.29 DeepSeek`.
 *
 * The distinction is not decoration. A run card carries two figures — this run's own books and the
 * plan's, which include every other run of it and the planner's own outing — and a bare `$6.29`
 * beside `this run 3/40` reads as this run's. Only the multi-run (or outside-spend) branch uses
 * this; a run that is its whole plan says the figure once, plainly.
 */
export function planPaidText(t: TFunction, usd: number | null | undefined): string {
  return paidWith(t, usd, 'runner.planTotal');
}

/**
 * A billed figure as money: `$0.41` at the cent, four decimals below it — `costs.money`'s rule.
 *
 * Two decimals alone draw a real bill as `$0.00`: 38 of the house's 715 chain stages bill between
 * $0.0005 and $0.005, which reads as "the vendor charged nothing" rather than as a small bill.
 */
export function moneyText(usd: number): string {
  return usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4);
}

function paidWith(t: TFunction, usd: number | null | undefined, key: string): string {
  const paid = count(usd);
  if (paid === null || paid <= 0) return '';
  return t(key, { usd: moneyText(paid), vendor: PAID_VENDOR });
}

/**
 * The token half: `1.2M in · 48k out` when the record carries the split, `⛁ 216M tok` when it
 * carries the total alone, and `''` when it carries neither.
 *
 * The split is shown only when BOTH parts were recorded together (`tokens_in` and `tokens_out` on
 * one record). `in + out > 0` is the test rather than `total > 0`, because the total is what a
 * pre-split record has: a real total of 216M with no parts must not render as `0 in · 0 out`.
 *
 * AND only when the two parts ARE that total. A plan whose stages are half pre-split carries parts
 * for some and a total alone for the rest, and `14.9M in · 165k out` under a plan that spent 270.9M
 * states 5% of it as if it were the sum (measured on the dispatcher board, 2026-09-24). Where the
 * three disagree the TOTAL speaks, in the form a record without a split already uses — the sum is
 * then never wrong, only less detailed. `costs.usage_line` keeps the identical rule.
 */
export function usageText(
  t: TFunction,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  total: number | null | undefined,
): string {
  const read = count(tokensIn) ?? 0;
  const written = count(tokensOut) ?? 0;
  const sum = count(total);
  const whole = sum === null || sum === 0 || read + written === sum;
  if (read + written > 0 && whole) {
    return t('runner.usage', { in: humanizeTokens(read), out: humanizeTokens(written) });
  }
  return sum !== null && sum > 0 ? t('runner.tokens', { n: humanizeTokens(sum) }) : '';
}

/**
 * Both halves, in the order they are read: what was paid, then the tokens. One figure is normal —
 * a Claude run has no first half and a record with no usage has no second.
 */
export function spendText(
  t: TFunction,
  usd: number | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  total: number | null | undefined,
): string {
  return [paidText(t, usd), usageText(t, tokensIn, tokensOut, total)].filter(Boolean).join(' · ');
}

/** One kind of a plan's ledger, as the plan card breaks its dollars down. */
export type PlanKindSpend = { kind: 'planning' | 'review' | 'scouts' | 'build'; usd: number };

/**
 * Where a plan's PAID dollars went — `planning $1.10 · build $4.49 in 12 runs` — or `''` when no
 * kind was billed at all.
 *
 * A kind that cost nothing is LEFT OUT rather than shown as `$0.00`: with Claude work off the
 * ledger, most kinds are 0 on most plans, and a line of four zeros hides the one figure that is
 * real. An empty list is not a rounding question but a fact — no API was billed — and it reads as
 * no dollar phrase at all.
 */
export function planKindsText(t: TFunction, kinds: readonly PlanKindSpend[], runs: number): string {
  const shown = kinds
    .filter((entry) => count(entry.usd) !== null && (entry.usd as number) > 0)
    .map((entry) => t(`runner.kind.${entry.kind}`, { usd: moneyText(entry.usd) }));
  if (shown.length === 0) return '';
  return t('runner.planKinds', { kinds: shown.join(' · '), count: runs });
}
