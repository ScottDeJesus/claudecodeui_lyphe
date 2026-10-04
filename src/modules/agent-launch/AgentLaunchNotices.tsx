import { useTranslation } from 'react-i18next';

import type { AgentLaunchCensus } from '@/shared/agent-launch-types';
import { Banner } from '@/shared/ui';

/**
 * Used by `AgentLaunchPanel`, at the top of the body: what is wrong with the table first, then the
 * one fact that qualifies every change on the page.
 *
 * WARNINGS COME BEFORE THE NOTICE because they are what to act on; the notice is the standing
 * context and is read once. Every warning is a `warn` Banner — an error here is amber, never red, and
 * carries its own mark — and each says what is true rather than that a rule fired:
 *  - the table itself was absent or malformed (the shipped values are in force);
 *  - the read's own sentences, all in one banner rather than a stack of them;
 *  - a regeneration that failed after a save (the write is KEPT — the sentence says so);
 *  - every row whose shim has fallen behind the table, each with the words it holds against the table's.
 * A soul's shim is what an Agent call and a fresh session read, so a shim that is behind is a pin that
 * has not arrived there.
 */
export function AgentLaunchNotices({ census }: { census: AgentLaunchCensus }) {
  const { t } = useTranslation();
  const noFlag = t('agentLaunch.row.noFlag');
  const words = (model: string, effort: string | null) => `${model} · ${effort ?? noFlag}`;
  const behind = census.rows.filter((row) => row.shim !== null && !row.shim.current);
  const failedRegen = census.regen !== null && census.regen.ran && !census.regen.ok ? census.regen : null;

  return (
    <div className="flex min-w-0 flex-col gap-2" data-agent-notices>
      {census.state !== 'file' && (
        <Banner tone="warn">{t(census.state === 'absent' ? 'agentLaunch.warnings.absent' : 'agentLaunch.warnings.malformed')}</Banner>
      )}
      {census.problems.length > 0 && (
        <Banner tone="warn">
          <p>{t('agentLaunch.warnings.problems')}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {census.problems.map((problem) => (
              <li key={problem} className="break-words">{problem}</li>
            ))}
          </ul>
        </Banner>
      )}
      {failedRegen && <Banner tone="warn"><span className="break-words">{t('agentLaunch.warnings.regen', { said: failedRegen.said })}</span></Banner>}
      {behind.length > 0 && (
        <Banner tone="warn">
          <p>{t('agentLaunch.warnings.shims', { count: behind.length })}</p>
          <ul className="mt-1 flex flex-col gap-0.5">
            {behind.map((row) => (
              <li key={row.name} className="break-words">
                {t('agentLaunch.warnings.shimLine', {
                  name: row.name,
                  shim: row.shim ? words(row.shim.model, row.shim.effort) : '',
                  table: words(row.model, row.effort),
                })}
              </li>
            ))}
          </ul>
        </Banner>
      )}
      <Banner tone="info">{t('agentLaunch.reach')}</Banner>
    </div>
  );
}
