import type { TFunction } from 'i18next';

import type { SpendParts } from '@/shared/types';

/**
 * What a soul — or a plan — has SPENT, as every card in this app writes it.
 *
 * A SPEND FIGURE IS DOLLARS **OR** TOKENS, BY WHO WAS USED (operator rule, 2026-09-24). A `$` is a
 * PAYING API's bill, labelled by the vendor that charged it (`$0.28 DeepSeek`); tokens are the
 * operator's Claude subscription's own work, read as `1.2M in · 48k out`. A record has one or the
 * other, never both at once:
 *
 *   `$0.28 DeepSeek`                      a soul, stage or phase DeepSeek billed — NO tokens
 *   `10.3k in · 80 out`                   a record on the subscription — no `$`, never `$0.00`
 *   `$0.32 DeepSeek · 12.4M in · 80k out` an AGGREGATE that used both hands, its token half
 *                                         counting the CLAUDE records only, never a vendor's
 *
 * A pure-DeepSeek aggregate is dollars only and a pure-Claude one tokens only, which the shapes
 * above give for free: each half is empty on its own. A vendor's tokens are its own business —
 * DeepSeek's own words, which is why they are not shown beside its bill.
 *
 * THE HALF IS SETTLED UPSTREAM, NOT HERE. Every figure this module renders is already the right
 * half when it arrives: the server reads a plan's or a soul's CLAUDE half and zeroes a vendor's
 * tokens (`server/modules/dispatch-souls/soul-launch.service.ts`), and the CLI does the same in
 * `plan_runner/costs.py`. So this file needs no provider parameter — it formats, and the
 * either/or falls out of the two figures being one or the other.
 *
 * ONE DECISION, TWO DRAWINGS. Which halves a record has is decided ONCE, by {@link spendParts}, and
 * drawn two ways from that one answer: as pills by the dispatcher's `SpendPills` (every phase row and
 * stage line of a plan card, the card's own total, and its arc deck's books), and as a sentence by
 * {@link spendText} — whose remaining readers are the chat strip's launcher-soul pins
 * (`SoulLaunchPinRow`), the heal cards (`HealCardList`) and the dispatcher's Delete dialog
 * (`DeletePlanDialog`), which names what a drop takes. Each screen draws the same figure from a
 * different record, and each of them feeding its own template literals is how one app ends up saying
 * `$0.41` on one screen and `0.41 USD` on the next — or a split on one and a total on the next. Every
 * one of them comes through here instead, and a change to the rule or the wording is a change to
 * this file.
 *
 * THE FIGURES ARE THE WALK'S OWN. `cost_usd` is PAID dollars by construction —
 * `hooks/plan_runner/costs.py:result_cost` returns 0 for a child on the Claude subscription — and
 * the tokens are the CLAUDE half of the child's usage, split into what it READ (input + cache read
 * + cache write) and what it wrote; a card's `in` pill adds the share of that READ served from
 * cache (`2.6M in (94% cache)`, {@link cachePercent}). A record written before the split shipped
 * carries the total alone, which reads as the total form (`⛁ n tok`, a `⛁ n tokens` pill) rather
 * than as `0 in · 0 out`; the split is omitted, the total never is.
 *
 * NOTHING HERE IS TRANSLATED-BY-HAND: the numbers are formatted here, the words come from the
 * caller's `t` (namespace `common`), so the strip and the tab say the same thing in one language.
 */

/**
 * The vendor a `$` figure is labelled by.
 *
 * A product name, not copy, which is why it is a constant and not a translation key: the CLI labels
 * the same figure the same way (`plan_runner/costs.py:PAID_VENDOR`). A vendor is drawn in TWO
 * places, and a second paying API would become a parameter of both, never a second constant: the
 * sentence's {@link paidText}, and the dispatcher's paid pill (`SpendPills`), whose title names this
 * constant and whose mark spells the provider itself (`LLMProviderLogo provider="deepseek"`).
 */
export const PAID_VENDOR = 'DeepSeek';

/**
 * Byte-for-byte `hooks/plan_runner/costs.py`'s `humanize`: "94.9M", "1M", "12.5k".
 *
 * `scale` is the figure whose SHAPE is drawn — its unit, and whether it keeps a decimal — and it is
 * the figure itself unless a caller says otherwise — and then this is exactly `humanize`. A
 * count-up passes its TARGET, the way it does to {@link moneyText}: the frames of a `206k` count read
 * `0k` … `206k` and those of `1.3M` read `0.0M` … `1.3M`, never `205.3k` or `999.9k` — a frame is
 * then never wider than the figure it lands on, so a pill held at its final width never overflows.
 */
export function humanizeTokens(n: number, scale: number = n): string {
  if (scale < 1000) return String(n);
  const [divisor, unit] = scale < 999_950 ? [1e3, 'k'] : [1e6, 'M'];   // the same cut
  const landed = (scale / divisor).toFixed(1).replace(/\.0$/, '');
  if (n === scale) return `${landed}${unit}`;
  return `${(n / divisor).toFixed(landed.includes('.') ? 1 : 0)}${unit}`;
}

/** A count off a JSON record, or `null` — an absent field and a `NaN` are both "not recorded". */
function count(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * A billed figure as money: `$0.41` at the cent, four decimals below it — `costs.money`'s rule.
 *
 * Two decimals alone draw a real bill as `$0.00`: 38 of the house's 715 chain stages bill between
 * $0.0005 and $0.005, which reads as "the vendor charged nothing" rather than as a small bill.
 *
 * `scale` is the figure whose precision is drawn, and it is the figure itself unless a caller says
 * otherwise: a count-up passes its TARGET, so the frames of a `$4.47` count read `$0.00` … `$4.47`
 * at the cent throughout instead of opening on `$0.0000` and changing width at a cent.
 */
export function moneyText(usd: number, scale: number = usd): string {
  return scale >= 0.01 ? usd.toFixed(2) : usd.toFixed(4);
}

/**
 * Which halves a record's spend has, decided once and not yet worded — the ONE home of both rules.
 *
 * THE PAID HALF is `null` for an absent figure or one of 0 or less, and that is the rule, not an
 * oversight: a figure of 0 means the work rode Claude, and `$0.00` would read as "this cost
 * nothing" when what it means is "this was not a bill". It is also what makes a Claude figure read
 * as tokens alone — with this half empty, a drawing has one part rather than two.
 *
 * THE TOKEN HALF is `split` (`1.2M in · 48k out`) when the record carries the split, `total`
 * (`⛁ 216M tok`) when it carries the total alone, and `null` when it carries neither.
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
 *
 * `cacheRead` is the part of `tokensIn` served from the prompt cache, and rides a split as its
 * `cacheRead` — `null` when the record does not state it (the dispatcher's `null`, or a caller that
 * passes none), which {@link cachePercent} draws as no share at all, never a `0%`.
 */
export function spendParts(
  usd: number | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  total: number | null | undefined,
  cacheRead?: number | null,
): SpendParts {
  const billed = count(usd);
  const read = count(tokensIn) ?? 0;
  const written = count(tokensOut) ?? 0;
  const sum = count(total);
  const whole = sum === null || sum === 0 || read + written === sum;
  const tokens: SpendParts['tokens'] = read + written > 0 && whole
    ? { kind: 'split', in: read, out: written, cacheRead: count(cacheRead) }
    : sum !== null && sum > 0 ? { kind: 'total', total: sum } : null;
  return { paid: billed !== null && billed > 0 ? billed : null, tokens };
}

/**
 * The share of `tokensIn` served from cache as a whole percent — the `in` pill's `(94% cache)` — or
 * `null` when it cannot be stated.
 *
 * Byte-for-byte `hooks/plan_runner/costs.py`'s `cache_percent`, so `dispatcher status` and the card
 * say the same number: `tokensIn` is input + cache read + cache write (the child's own `usage`
 * block), and the numerator is the cache READ alone — a cache write was processed fresh. Rounded
 * half UP (`Math.floor(x + 0.5)`; Python's `round` would go half-to-even), then held off the two
 * ends it would lie at: `100` only when every token came from cache and `0` only when none did.
 * `null` for an unknown numerator, an empty `in`, or a numerator larger than `in` (two figures that
 * disagree state no share).
 */
export function cachePercent(cacheRead: number | null, tokensIn: number): number | null {
  if (cacheRead === null || tokensIn <= 0 || cacheRead < 0 || cacheRead > tokensIn) return null;
  if (cacheRead === 0) return 0;
  const share = Math.floor((100 * cacheRead) / tokensIn + 0.5);
  return Math.max(cacheRead < tokensIn ? Math.min(share, 99) : share, 1);
}

/** The paid half as words, `$0.28 DeepSeek`, or `''` when {@link spendParts} found no bill. */
function paidText(t: TFunction, paid: SpendParts['paid']): string {
  return paid === null ? '' : t('runner.paid', { usd: moneyText(paid), vendor: PAID_VENDOR });
}

/** The token half as words, `1.2M in · 48k out` or `⛁ 216M tok`, or `''` when there is none. */
function usageText(t: TFunction, tokens: SpendParts['tokens']): string {
  if (tokens === null) return '';
  return tokens.kind === 'split'
    ? t('runner.usage', { in: humanizeTokens(tokens.in), out: humanizeTokens(tokens.out) })
    : t('runner.tokens', { n: humanizeTokens(tokens.total) });
}

/**
 * Both halves as one sentence, in the order they are read: what was paid, then the tokens. ONE
 * FIGURE IS NORMAL and is the whole point — a Claude record has no first half, a record a vendor
 * billed has no second, and an aggregate that used both hands has both, its token half counting
 * the CLAUDE records only (settled upstream, never here).
 */
export function spendText(
  t: TFunction,
  usd: number | null | undefined,
  tokensIn: number | null | undefined,
  tokensOut: number | null | undefined,
  total: number | null | undefined,
): string {
  const parts = spendParts(usd, tokensIn, tokensOut, total);
  return [paidText(t, parts.paid), usageText(t, parts.tokens)].filter(Boolean).join(' · ');
}
