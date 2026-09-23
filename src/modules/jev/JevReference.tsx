import { useTranslation } from 'react-i18next';

import { ago, count } from '@/modules/jev/jevFormat';
import type { JevReferenceRow } from '@/shared/types';
import { Badge } from '@/shared/ui';

/**
 * Used by JevPanel as its last block: every caller the consumer map or the ledger knows, what it
 * asks, where it lives, how often it has called all-time and when it last did.
 *
 * A caller the map has no line for is the one row that asks for work: it wears `unmapped` and says
 * where the description goes, because a name in the ledger with no sentence beside it is a caller
 * nobody can judge the spend of.
 */
export function JevReference({ reference }: { reference: JevReferenceRow[] }) {
  const { t } = useTranslation();
  const columns = [
    { key: 'caller', label: 'caller', numeric: false },
    { key: 'asks', label: 'asks', numeric: false },
    { key: 'source', label: 'source', numeric: false },
    { key: 'calls', label: 'calls (all time)', numeric: true },
    { key: 'last', label: 'last seen', numeric: true },
  ];

  if (reference.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('jev.reference.empty', { defaultValue: 'No caller is known yet' })}</p>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm" data-jev-reference>
        <thead>
          <tr className="border-b border-border text-xs text-muted-foreground">
            {columns.map((col) => (
              <th key={col.key} scope="col" className={`whitespace-nowrap py-1.5 pr-3 font-medium ${col.numeric ? 'text-right' : 'text-left'}`}>
                {t(`jev.reference.columns.${col.key}`, { defaultValue: col.label })}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {reference.map((row) => (
            <tr key={row.caller} className="border-b border-border/60 align-top" data-jev-reference-row={row.caller}>
              <td className="whitespace-nowrap py-1.5 pr-3">
                <span className="font-mono text-xs">{row.caller}</span>
                {!row.mapped && (
                  <Badge as="span" tone="warn" className="ml-2 text-xs"><span aria-hidden="true">▲</span>&nbsp;{t('jev.reference.unmapped', { defaultValue: 'unmapped' })}</Badge>
                )}
              </td>
              <td className="min-w-[14rem] py-1.5 pr-3 text-xs">
                {row.mapped && row.asks !== null
                  ? row.asks
                  : <span className="text-muted-foreground">{t('jev.reference.unmappedLine', { defaultValue: 'no description yet — add it to the Jev consumer map' })}</span>}
              </td>
              <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs text-muted-foreground">{row.source ?? '—'}</td>
              <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{count(row.calls_all)}</td>
              <td className="whitespace-nowrap py-1.5 text-right font-mono text-xs tabular-nums text-muted-foreground">
                {row.last_ts === null ? t('jev.reference.never', { defaultValue: 'never' }) : t('jev.reference.ago', { defaultValue: '{{ago}} ago', ago: ago(row.last_ts) })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
