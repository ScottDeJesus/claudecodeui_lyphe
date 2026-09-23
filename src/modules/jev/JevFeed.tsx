import { useTranslation } from 'react-i18next';

import { ago, seconds, toneGlyph, tokens } from '@/modules/jev/jevFormat';
import type { JevFeedRow, Tone } from '@/shared/types';
import { Badge, Chip } from '@/shared/ui';

type Outcome = { tone: Tone; key: string; label: string };

/** What a row was, as one toned word: the verb decides for a cache hit or a refusal, `ok` for a call. */
function outcomeOf(row: JevFeedRow): Outcome {
  if (row.verb === 'cache_hit') return { tone: 'info', key: 'cacheHit', label: 'cache hit' };
  if (row.verb === 'budget') return { tone: 'neutral', key: 'refused', label: 'refused' };
  if (row.ok === true) return { tone: 'positive', key: 'ok', label: 'ok' };
  if (row.ok === false) return { tone: 'warn', key: 'unavailable', label: 'unavailable' };
  return { tone: 'neutral', key: 'report', label: 'report' };
}

type JevFeedProps = {
  feed: JevFeedRow[];
  /** The caller the table picked, or null for every caller. */
  caller: string | null;
  onClearCaller: () => void;
};

/**
 * Used by JevPanel as its fourth block: the newest rows of the ledger, one line each.
 *
 * There is NO TEXT here, and the caption says so: the ledger keeps a row's verb, answer and size and
 * never the question, so the feed cannot show one. Each row ends in its outcome — ok, unavailable, a
 * cache hit, a refusal, or a report row (`saved`, `filter_kept`) — toned and glyphed. The filter is
 * the consumers table's press, cleared by its own chip.
 */
export function JevFeed({ feed, caller, onClearCaller }: JevFeedProps) {
  const { t } = useTranslation();
  const rows = caller === null ? feed : feed.filter((row) => row.caller === caller);
  const columns = [
    { key: 'when', label: 'when', numeric: false },
    { key: 'caller', label: 'caller', numeric: false },
    { key: 'verb', label: 'verb', numeric: false },
    { key: 'answer', label: 'answer', numeric: false },
    { key: 'tokens', label: 'tokens', numeric: true },
    { key: 'latency', label: 'latency', numeric: true },
    { key: 'outcome', label: 'outcome', numeric: false },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">
          {t('jev.feed.caption', { defaultValue: 'newest first · updates every 10 s · no text: the ledger keeps the verb, the answer and the size, never what was asked' })}
        </p>
        {caller !== null && (
          <Chip selected size="sm" onClick={onClearCaller} title={t('jev.feed.clear', { defaultValue: 'Clear the caller filter' })}>
            {t('jev.feed.filtered', { defaultValue: 'only {{caller}}', caller })} ✕
          </Chip>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('jev.feed.empty', { defaultValue: 'Nothing in the feed yet' })}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-jev-feed>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {columns.map((col) => (
                  <th key={col.key} scope="col" className={`whitespace-nowrap py-1.5 pr-3 font-medium ${col.numeric ? 'text-right' : 'text-left'}`}>
                    {t(`jev.feed.columns.${col.key}`, { defaultValue: col.label })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const outcome = outcomeOf(row);
                // Keyed by position: the ledger repeats (ts, caller, verb) triples, and a newest-first
                // window has no stable identity a row could carry.
                return (
                  <tr key={i} className="border-b border-border/60">
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs tabular-nums text-muted-foreground">{ago(row.ts)}</td>
                    <td className="max-w-[14rem] truncate py-1.5 pr-3 font-mono text-xs">{row.caller}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">
                      {row.verb}
                      {row.items !== null && <span className="text-muted-foreground"> ×{row.items}</span>}
                    </td>
                    <td className="max-w-[10rem] truncate py-1.5 pr-3 font-mono text-xs">{row.answer === null ? '—' : String(row.answer)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{row.tokens === null ? '—' : tokens(row.tokens)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{seconds(row.latency_s)}</td>
                    <td className="whitespace-nowrap py-1.5 text-left">
                      <Badge as="span" tone={outcome.tone} className="text-xs">
                        <span aria-hidden="true">{toneGlyph(outcome.tone)}</span>&nbsp;{t(`jev.feed.${outcome.key}`, { defaultValue: outcome.label })}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
