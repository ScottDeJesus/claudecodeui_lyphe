import { useTranslation } from 'react-i18next';

import { pct, tokens, usd } from '@/modules/jev';
import type { DeepseekColumns, DeepseekUsageSummary } from '@/shared/types';

type DeepseekWhereProps = Pick<DeepseekUsageSummary, 'roles' | 'models' | 'souls' | 'columns' | 'endpoint' | 'outings'>;

const COLUMN_KEYS: (keyof DeepseekColumns)[] = ['input', 'output', 'cache_read', 'cache_write'];

/** The endpoint's host, or the endpoint itself when it is not a URL the browser can parse. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return endpoint;
  }
}

/** One compact share list: a word, a bar, the dollars and the share, the biggest first as the reader sends them. */
function ShareList({ title, rows, id }: { title: string; rows: { key: string; usd: number; share: number; tokens?: number }[]; id: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-deepseek-share={id}>
      <h4 className="text-xs text-muted-foreground">{title}</h4>
      <ul className="flex flex-col gap-1">
        {rows.map((row) => (
          <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_4rem_7.5rem] items-center gap-2 text-xs">
            <span className="truncate font-mono" title={row.key}>{row.key}</span>
            <span className="h-1.5 overflow-hidden rounded bg-muted" aria-hidden="true">
              <span className="block h-full rounded bg-primary/60" style={{ width: `${Math.round(row.share * 100)}%` }} />
            </span>
            <span className="whitespace-nowrap text-right font-mono tabular-nums">
              {usd(row.usd)} <span className="text-muted-foreground">{row.tokens !== undefined ? tokens(row.tokens) : pct(row.share)}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Used by DeepseekUsagePanel as its third block: where the range's dollars went, four ways at once —
 * by role, by model, by soul, and by token column (so "is it the cache reads" answers itself) — then
 * the one endpoint every outing goes to, then the range's outings as rows. Transcripts record no base
 * URL, so the endpoint is the house's one, said once rather than repeated on every row.
 */
export function DeepseekWhere({ roles, models, souls, columns, endpoint, outings }: DeepseekWhereProps) {
  const { t } = useTranslation();
  const total = COLUMN_KEYS.reduce((sum, key) => sum + columns[key].usd, 0);
  const columnRows = COLUMN_KEYS.map((key) => ({
    key: t(`deepseekUsage.where.columnNames.${key}`),
    usd: columns[key].usd,
    share: total > 0 ? columns[key].usd / total : 0,
    tokens: columns[key].tokens,
  }));
  const cols = ['soul', 'role', 'model', 'kind', 'name', 'run', 'tokens', 'usd'];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 [@container(min-width:40rem)]:grid-cols-2 [@container(min-width:64rem)]:grid-cols-4">
        <ShareList id="roles" title={t('deepseekUsage.where.roles')} rows={roles} />
        <ShareList id="models" title={t('deepseekUsage.where.models')} rows={models} />
        <ShareList id="souls" title={t('deepseekUsage.where.souls')} rows={souls} />
        <ShareList id="columns" title={t('deepseekUsage.where.columns')} rows={columnRows} />
      </div>

      <p className="text-xs text-muted-foreground" data-deepseek-endpoint>
        {t('deepseekUsage.where.endpoint', { host: hostOf(endpoint) })}
      </p>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-xs text-muted-foreground">{t('deepseekUsage.where.outings')}</h4>
        {outings.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('deepseekUsage.where.noOutings')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-deepseek-outings>
              <thead>
                <tr className="border-b border-border text-xs text-muted-foreground">
                  {cols.map((col) => (
                    <th key={col} scope="col" className={`whitespace-nowrap py-1.5 pr-3 font-medium ${col === 'tokens' || col === 'usd' ? 'text-right' : 'text-left'}`}>
                      {t(`deepseekUsage.where.cols.${col}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {outings.map((row) => (
                  <tr key={row.outing} className="border-b border-border/60" data-deepseek-outing={row.outing}>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">{row.soul ?? t('deepseekUsage.where.unknownSoul')}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">{row.role}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 font-mono text-xs">{row.model}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-xs text-muted-foreground">{t(`deepseekUsage.kind.${row.kind}`, { defaultValue: row.kind })}</td>
                    <td className="max-w-[14rem] truncate py-1.5 pr-3 font-mono text-xs" title={row.name}>{row.name}</td>
                    <td className="max-w-[12rem] truncate py-1.5 pr-3 font-mono text-xs text-muted-foreground" title={row.run_id ?? undefined}>{row.run_id ?? '—'}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{tokens(row.tokens)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-3 text-right font-mono text-xs tabular-nums">{usd(row.usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
