import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { callsKey, countWords, tokenWords, usdWords } from '@/modules/gemini-spend/geminiFigures';
import { cn } from '@/shared/utils';

type GeminiRowProps = {
  /** What the row counts: a feature's label, a budget's name, a key's last four, a process. */
  name: ReactNode;
  /** A name that is the system's own string (a budget, a key, a process) is set in the mono face. */
  mono?: boolean;
  /** Quiet words after the name: what holds a key. */
  detail?: ReactNode;
  /** The row's marks, as Badges: off, unmeasured, unpriced, not counted. */
  marks?: ReactNode;
  calls: number;
  /** Input and output tokens together. Left off, the row has no token figure (a budget, a key, a process). */
  tokens?: number;
  /** The estimate at list prices; null is no rate, drawn as a dash and never as $0.00. */
  costUsd: number | null;
  /** False for a row whose mark already says it was not counted. */
  sayNoCalls?: boolean;
  /** What stands at the row's end: the feature's Switch. */
  end?: ReactNode;
};

/**
 * One counted row of the Gemini view, and the one drawing every list of it shares: a feature of either door, a budget,
 * a key, a process. Name and marks first, then calls, tokens and dollars, each with its unit so no column needs a head,
 * the dollars in the full ink because they are the answer. Under 44rem of panel the figures drop under the name; from
 * there up they stand in fixed right-aligned cells, so a list's figures line up down the page.
 * A row nothing called says "No calls" once, never three zeros.
 */
export function GeminiRow({ name, mono = false, detail, marks, calls, tokens, costUsd, sayNoCalls = true, end }: GeminiRowProps) {
  const { t } = useTranslation();
  return (
    <li className="flex min-w-0 items-center gap-3 px-3 py-2.5" data-gemini-row>
      <div className="flex min-w-0 flex-1 flex-col gap-1 [@container(min-width:44rem)]:flex-row [@container(min-width:44rem)]:items-center [@container(min-width:44rem)]:gap-4">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('min-w-0 [overflow-wrap:anywhere]', mono ? 'font-mono text-xs' : 'text-sm')}>{name}</span>
          {detail !== undefined && <span className="min-w-0 text-xs text-muted-foreground [overflow-wrap:anywhere]">{detail}</span>}
          {marks}
        </div>
        {calls > 0 ? (
          <div className="flex flex-none flex-wrap items-baseline gap-x-4 gap-y-0.5 font-mono text-xs tabular-nums text-muted-foreground">
            <span className="[@container(min-width:44rem)]:w-24 [@container(min-width:44rem)]:text-right">{t(callsKey(calls), { calls: countWords(calls) })}</span>
            {tokens !== undefined && (
              <span className="[@container(min-width:44rem)]:w-28 [@container(min-width:44rem)]:text-right">{t('api.gemini.row.tokens', { tokens: tokenWords(tokens) })}</span>
            )}
            <span className="text-foreground [@container(min-width:44rem)]:w-20 [@container(min-width:44rem)]:text-right">
              {costUsd === null ? (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">{t('api.gemini.unknown')}</span>
                </>
              ) : (
                usdWords(costUsd)
              )}
            </span>
          </div>
        ) : (
          sayNoCalls && <span className="flex-none font-mono text-xs text-muted-foreground">{t('api.gemini.row.noCalls')}</span>
        )}
      </div>
      {end}
    </li>
  );
}

/** The list those rows stand in: one ruled frame, a hairline between rows. */
export function GeminiRows({ children }: { children: ReactNode }) {
  return <ul className="flex min-w-0 flex-col divide-y divide-border/60 rounded-lg border border-border">{children}</ul>;
}
