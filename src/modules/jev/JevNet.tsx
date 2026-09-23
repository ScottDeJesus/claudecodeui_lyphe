import { useTranslation } from 'react-i18next';

import { count, signedChars, toneGlyph } from '@/modules/jev/jevFormat';
import type { JevSummary, Tone } from '@/shared/types';
import { Badge } from '@/shared/ui';

/**
 * Used by JevPanel as the block beside the burn: the value side of the spend, ALL-TIME whatever the
 * range picker says (the reader's `net` never takes a range, and the caption says so).
 *
 * The lead figure keeps its SIGN. Positive is text Jev kept out of sessions; negative is text a
 * consumer added to one — a sign dropped here would draw context Jev cost the operator as context
 * it saved. Session tokens are the reader's own `chars // 4`, floored the way Python floors.
 */
export function JevNet({ net }: { net: JevSummary['net'] }) {
  const { t } = useTranslation();
  const rows = [...net.by_caller].sort((a, b) => b.chars - a.chars);
  const sessionTokens = Math.floor(net.net_chars / 4);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" data-jev-net-lead>
          <span className="font-mono text-2xl font-semibold tabular-nums">{signedChars(net.net_chars)}</span>
          <span className="text-sm text-muted-foreground">{t('jev.net.chars', { defaultValue: 'chars' })}</span>
          <span className="font-mono text-sm tabular-nums">
            {t('jev.net.tokens', { defaultValue: '≈ {{value}} session tokens', value: signedChars(sessionTokens) })}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">{t('jev.net.legend', { defaultValue: '+ kept out of sessions, − added' })}</p>
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <div className="min-w-0 rounded-lg border border-border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('jev.net.filtered', { defaultValue: 'lines filtered' })}</dt>
          <dd className="whitespace-nowrap font-mono text-base tabular-nums">{count(net.lines_in)} → {count(net.lines_kept)}</dd>
          <dd className="text-xs text-muted-foreground">{t('jev.net.filteredHint', { defaultValue: 'in → kept' })}</dd>
        </div>
        <div className="min-w-0 rounded-lg border border-border px-3 py-2">
          <dt className="text-xs text-muted-foreground">{t('jev.net.saved', { defaultValue: 'chars the filter left unread' })}</dt>
          <dd className="font-mono text-lg tabular-nums">{count(net.chars_saved)}</dd>
          <dd className="text-xs text-muted-foreground">{t('jev.net.savedHint', { defaultValue: '≈ {{value}} session tokens', value: count(Math.floor(net.chars_saved / 4)) })}</dd>
        </div>
      </dl>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('jev.net.empty', { defaultValue: 'Jev has not kept any context out yet' })}</p>
      ) : (
        <ul className="flex flex-col gap-1" aria-label={t('jev.net.byCaller', { defaultValue: 'Net context by caller' })} data-jev-net-rows>
          {rows.map((row) => {
            const tone: Tone = row.chars < 0 ? 'warn' : 'positive';
            return (
              <li key={row.caller} className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-mono text-xs">{row.caller}</span>
                <Badge as="span" tone={tone} className="font-mono tabular-nums">
                  <span aria-hidden="true">{toneGlyph(tone)}</span>&nbsp;{signedChars(row.chars)}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
