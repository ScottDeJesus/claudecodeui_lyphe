import { useTranslation } from 'react-i18next';

import { ago, tokens, usd } from '@/modules/jev';
import type { DeepseekOuting } from '@/shared/types';

const COLUMNS: { key: string; numeric: boolean }[] = [
  { key: 'when', numeric: false },
  { key: 'soul', numeric: false },
  { key: 'role', numeric: false },
  { key: 'model', numeric: false },
  { key: 'consumer', numeric: false },
  { key: 'tokens', numeric: true },
  { key: 'usd', numeric: true },
];

/**
 * Used by DeepseekUsagePanel as its fourth block: the newest DeepSeek outings, one line each, newest
 * first and across every range — the feed answers "what is spending right now", which a range
 * picker would only hide. There is no prompt text here, and the caption says so: the ledger keeps
 * tokens and who spent them, never what was asked. The consumer cell is the outing's kind and name,
 * the same pair the consumers table groups by, so a row reads back to its line in that table.
 */
export function DeepseekFeed({ feed }: { feed: DeepseekOuting[] }) {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">{t('deepseekUsage.feed.caption')}</p>

      {feed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('deepseekUsage.feed.empty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-deepseek-feed>
            <thead>
              <tr className="border-b border-border text-xs text-muted-foreground">
                {COLUMNS.map((col) => (
                  <th key={col.key} scope="col" className={`whitespace-nowrap py-1.5 pr-3 font-medium ${col.numeric ? 'text-right' : 'text-left'}`}>
                    {t(`deepseekUsage.feed.cols.${col.key}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {feed.map((row) => (
                <tr key={row.outing} className="border-b border-border/60" data-deepseek-feed-row={row.outing}>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs tabular-nums text-muted-foreground">{ago(row.last_at)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">{row.soul ?? t('deepseekUsage.where.unknownSoul')}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">{row.role}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">{row.model}</td>
                  <td className="max-w-[16rem] truncate py-1.5 pr-3 text-xs" title={`${row.kind} · ${row.name}`}>
                    <span className="text-muted-foreground">{t(`deepseekUsage.kind.${row.kind}`, { defaultValue: row.kind })}</span>{' '}
                    <span className="font-mono">{row.name}</span>
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{tokens(row.tokens)}</td>
                  <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{usd(row.usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
