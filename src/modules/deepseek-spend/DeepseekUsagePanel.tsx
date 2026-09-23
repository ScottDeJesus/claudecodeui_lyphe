import { PlugZapIcon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DeepseekBurn } from '@/modules/deepseek-spend/DeepseekBurn';
import { DeepseekConsumers } from '@/modules/deepseek-spend/DeepseekConsumers';
import { DeepseekFeed } from '@/modules/deepseek-spend/DeepseekFeed';
import { sampleUsage } from '@/modules/deepseek-spend/deepseekFixtures';
import { DeepseekRecon } from '@/modules/deepseek-spend/DeepseekRecon';
import { DeepseekSwitches } from '@/modules/deepseek-spend/DeepseekSwitches';
import { DeepseekWhere } from '@/modules/deepseek-spend/DeepseekWhere';
import { JevSection } from '@/modules/jev';
import type { DeepseekRange, DeepseekUsageSummary } from '@/shared/types';
import { Banner, Button, DeepSeekLogo, EmptyState, ScrollArea, Spinner, Tooltip } from '@/shared/ui';

/**
 * The DeepSeek view of the API tab: what the house spends on DeepSeek, who spends it, where it goes,
 * and whether the ledger's pricing agrees with the vendor's balance.
 *
 * DRAWN IN THE JEV VIEW'S HAND — the same section frame, formatters, density and tones — so the two
 * sub-tabs read as one surface. Ordered the way the eye asks: balance and burn first, then the
 * biggest consumers (the range picker there, because those are the numbers a range changes), where
 * the money goes, the newest outings, the switches that route work here (mirrored, never set), and
 * last the reconciliation of ledger against balance.
 *
 * FOUR NON-DENSE STATES, EACH ITS OWN FACT, as in the Jev view: not asked yet is a spinner; a reader
 * that could not be asked is a plug-out with the reason and a retry; a ledger never written is an
 * empty state over the switches and the reconciliation (the switches say why nothing ran, the balance
 * log may already hold readings); a poll that fails after a good read keeps the last reading under an
 * amber line. A balance never read is drawn by the burn and recon blocks themselves.
 */
export function DeepseekUsagePanel() {
  const { t } = useTranslation();
  const [range, setRange] = useState<DeepseekRange>('today');
  // FILL: useDeepseekUsage
  const { data, loading, error }: { data: DeepseekUsageSummary | null; loading: boolean; error: string | null } = { data: sampleUsage(range), loading: false, error: null };
  // FILL: onRangeChange
  const onRangeChange = (next: DeepseekRange) => setRange(next);
  // FILL: onRefresh
  const onRefresh = () => {};
  const refreshLabel = t('deepseekUsage.refresh');

  return (
    <div className="flex h-full flex-col [container-type:inline-size]" data-deepseek-usage>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10">
          <DeepSeekLogo className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-medium">{t('deepseekUsage.title')}</h2>
        <div className="ml-auto">
          <Tooltip content={refreshLabel} position="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label={refreshLabel}
              disabled={loading}
              onClick={onRefresh}
              data-deepseek-refresh
            >
              <RefreshCwIcon aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </header>

      {data === null && loading ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <Spinner label={t('deepseekUsage.reading')} />
        </div>
      ) : data === null ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <EmptyState
            icon={PlugZapIcon}
            title={t('deepseekUsage.unreachable.title')}
            message={error ?? undefined}
            actionLabel={t('deepseekUsage.unreachable.retry')}
            onAction={onRefresh}
          />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {/* FILL: sampleNotice */}
          <Banner tone="info">{t('deepseekUsage.sampleNotice')}</Banner>
          {error && <Banner tone="warn">{error}</Banner>}
          <div className="flex w-full min-w-0 flex-col gap-8 px-4 py-5 [@container(min-width:48rem)]:px-6" data-deepseek-body>
            {!data.ledger.present ? (
              <EmptyState title={t('deepseekUsage.empty.title')} message={t('deepseekUsage.empty.message')} />
            ) : (
              <>
                <div className="min-w-0" data-deepseek-section="burn">
                  <JevSection id="deepseek-burn" title={t('deepseekUsage.sections.burn')} hint={t('deepseekUsage.sections.burnHint')}>
                    <DeepseekBurn balance={data.balance} spend={data.spend} days={data.days} pricing={data.pricing} ledger={data.ledger} />
                  </JevSection>
                </div>
                <div className="min-w-0" data-deepseek-section="consumers">
                  <JevSection id="deepseek-consumers" title={t('deepseekUsage.sections.consumers')} hint={t('deepseekUsage.sections.consumersHint')}>
                    <DeepseekConsumers consumers={data.consumers} top={data.top} kinds={data.kinds} totals={data.totals} range={range} onRangeChange={onRangeChange} />
                  </JevSection>
                </div>
                <div className="min-w-0" data-deepseek-section="where">
                  <JevSection id="deepseek-where" title={t('deepseekUsage.sections.where')} hint={t('deepseekUsage.sections.whereHint')}>
                    <DeepseekWhere roles={data.roles} models={data.models} souls={data.souls} columns={data.columns} endpoint={data.endpoint} outings={data.outings} />
                  </JevSection>
                </div>
                <div className="min-w-0" data-deepseek-section="feed">
                  <JevSection id="deepseek-feed" title={t('deepseekUsage.sections.feed')} hint={t('deepseekUsage.sections.feedHint')}>
                    <DeepseekFeed feed={data.feed} />
                  </JevSection>
                </div>
              </>
            )}
            <div className="grid gap-8 [@container(min-width:56rem)]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="min-w-0" data-deepseek-section="switches">
                <JevSection id="deepseek-switches" title={t('deepseekUsage.sections.switches')} hint={t('deepseekUsage.sections.switchesHint')}>
                  <DeepseekSwitches />
                </JevSection>
              </div>
              <div className="min-w-0" data-deepseek-section="recon">
                <JevSection id="deepseek-recon" title={t('deepseekUsage.sections.recon')} hint={t('deepseekUsage.sections.reconHint')}>
                  <DeepseekRecon recon={data.recon} />
                </JevSection>
              </div>
            </div>
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
