import { ArrowDown, ArrowUp } from 'lucide-react';
import type { TFunction } from 'i18next';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { useCountUp } from '@/modules/dispatcher/hooks/useCountUp';
import { cachePercent, humanizeTokens, moneyText, PAID_VENDOR } from '@/shared/spend';
import { Badge, LLMProviderLogo } from '@/shared/ui';
import type { SpendParts } from '@/shared/types';

/** Which figure a pill carries — its `data-spend-pill` handle and the tail of its count key. */
type PillHalf = 'paid' | 'in' | 'out' | 'tokens';

/** One figure's words, from its number: the final figure, or a frame of its count. */
type FigureWords = (value: number) => string;

/**
 * A figure counting to `value`. The moving words are for the eye and are `aria-hidden`; the final
 * words ride a visually hidden node beside them, so a screen reader reads the figure once, settled,
 * instead of every frame of the count.
 *
 * THE PILL IS ITS FINAL WIDTH FROM THE FIRST FRAME. The count and an `invisible` copy of where it
 * lands share ONE grid cell, so the cell is the landing's width and the row wraps once, at first
 * paint — never on the frame after it. Measured before this: 9 of 14 card totals painted `$0.00 ·
 * 0 in · 0 out` on one 29px line and jumped to 62px on the next frame, moving every card beneath.
 * It holds because a count UP never draws a frame wider than its landing: `words` draws each frame
 * in the TARGET's shape (`moneyText`'s and `humanizeTokens`' `scale`), and every frame is below it.
 * The one case it does not pin is a total that SHRINKS (a phase re-settled lower, INV-181), whose
 * frames can be a digit wider than the landing for the moments of that count.
 */
function CountingFigure({ value, words, countKey }: { value: number; words: FigureWords; countKey: string }) {
  const shown = useCountUp(value, countKey);
  return (
    <>
      <span aria-hidden="true" className="inline-grid">
        <span className="col-start-1 row-start-1">{words(shown)}</span>
        <span className="invisible col-start-1 row-start-1">{words(value)}</span>
      </span>
      <span className="sr-only">{words(value)}</span>
    </>
  );
}

/**
 * One pill: its mark, then its figure — counting when the caller gave a key, else simply stated —
 * then its `suffix`, a qualifier of the figure that is STATED, never counted (the `in` pill's
 * `(94% cache)`): it is decided off the target figures, so it is its final width from frame one.
 */
function Pill({ half, mark, value, words, countKey, title, suffix }: {
  half: PillHalf;
  mark: ReactNode;
  value: number;
  words: FigureWords;
  countKey?: string;
  title?: string;
  suffix?: ReactNode;
}) {
  return (
    <Badge as="span" tone="neutral" className="min-w-0 gap-1" title={title} data-spend-pill={half}>
      {mark}
      <span className="tabular-nums">
        {countKey === undefined
          ? words(value)
          : <CountingFigure value={value} words={words} countKey={`${countKey}:${half}`} />}
      </span>
      {suffix}
    </Badge>
  );
}

/**
 * The `in` pill's cache share as its muted suffix and its exact title, or `null` where the record
 * states no cache read — which draws no suffix, never a `0%` nobody measured (`cachePercent`).
 *
 * Muted by WEIGHT, not by ink: the neutral ink already sits at ~4.5:1 on its soft fill, so a
 * lighter colour or an opacity would take the share below readable contrast.
 */
function cacheWords(t: TFunction, cacheRead: number | null, tokensIn: number): { suffix: ReactNode; title: string } | null {
  const share = cachePercent(cacheRead, tokensIn);
  if (share === null || cacheRead === null) return null;
  return {
    suffix: (
      <span className="font-normal" data-spend-cache={share}>
        {t('dispatcher.pill.cache', { pct: share })}
      </span>
    ),
    title: t('dispatcher.pill.cacheTitle', { hit: humanizeTokens(cacheRead), n: humanizeTokens(tokensIn) }),
  };
}

/**
 * A spend figure as a row of pills — the halves `spendParts` decided, each drawn only where it
 * exists: the paid dollars behind the vendor's mark, then the CLAUDE tokens, as `in` and `out` where
 * the record's split is whole and as one `tokens` total where it is not, the `in` pill carrying the
 * share of those tokens served from cache (`2.6M in (94% cache)`, `cachePercent`) wherever the record
 * states it and nothing where it does not — never a `0%` nobody measured. A DOLLARS-OR-TOKENS record
 * therefore draws one kind of pill and never a `$0.00` (`src/shared/spend.ts`), and a record with
 * neither half draws nothing at all.
 *
 * THE SPLIT IS DECIDED ONCE, on the target figures the caller handed in. A count draws each pill's
 * number on its way to its target, and never re-asks `spendParts` along the way — a split whose
 * halves count at different speeds would otherwise flicker to a total mid-count.
 *
 * `countKey` is for a card's TOTAL (a plan's, an arc's): its figures count up from 0 at first sight
 * and from where they stood on every change (`useCountUp`), keyed `<countKey>:<half>`. A phase's or a
 * stage's figure is stated, because a card of fourteen phases counting at once is noise, not news.
 *
 * Every pill carries a mark and a word (design doctrine §6) and is `tone="neutral"`: a spend is a
 * fact, not a verdict. Every element is phrasing content, because a phase row draws its pills inside
 * its fold's trigger button. The row states its own face (`font-sans`), so a pill reads the same in
 * a stage line's mono as in a header.
 *
 * Used by `PlanPhaseRow` (each phase and each stage line), `PlanCard` (the card's total) and
 * `DispatchArcDeck` (the arc's books).
 */
export function SpendPills({ parts, countKey }: { parts: SpendParts; countKey?: string }) {
  const { t } = useTranslation();
  const { paid, tokens } = parts;
  if (paid === null && tokens === null) return null;

  const icon = 'h-3.5 w-3.5 flex-none';
  // A count's frame in its target's own shape (`humanizeTokens`' `scale`), so no frame outgrows the
  // pill `CountingFigure` holds at the landing's width.
  const count = (value: number, target: number) => humanizeTokens(Math.round(value), target);
  // Off the TARGET figures, like the split itself: the share is stated, never counted.
  const cache = tokens?.kind === 'split' ? cacheWords(t, tokens.cacheRead, tokens.in) : null;

  return (
    <span data-spend-pills className="flex min-w-0 flex-wrap items-center gap-1 font-sans">
      {paid !== null && (
        <Pill
          half="paid"
          mark={<LLMProviderLogo provider="deepseek" className={icon} />}
          value={paid}
          words={(value) => t('dispatcher.pill.paid', { usd: moneyText(value, paid) })}
          countKey={countKey}
          title={t('dispatcher.pill.paidTitle', { usd: moneyText(paid), vendor: PAID_VENDOR })}
        />
      )}
      {tokens?.kind === 'split' && (
        <>
          <Pill
            half="in"
            mark={<ArrowDown className={icon} aria-hidden="true" />}
            value={tokens.in}
            words={(value) => t('dispatcher.pill.in', { n: count(value, tokens.in) })}
            countKey={countKey}
            suffix={cache?.suffix}
            title={cache?.title}
          />
          <Pill
            half="out"
            mark={<ArrowUp className={icon} aria-hidden="true" />}
            value={tokens.out}
            words={(value) => t('dispatcher.pill.out', { n: count(value, tokens.out) })}
            countKey={countKey}
          />
        </>
      )}
      {tokens?.kind === 'total' && (
        <Pill
          half="tokens"
          mark={<span className="flex-none" aria-hidden="true">⛁</span>}
          value={tokens.total}
          words={(value) => t('dispatcher.pill.tokens', { n: count(value, tokens.total) })}
          countKey={countKey}
        />
      )}
    </span>
  );
}
