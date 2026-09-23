import { PlugZapIcon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { JevBurn } from '@/modules/jev/JevBurn';
import { JevConsumers } from '@/modules/jev/JevConsumers';
import { JevControls } from '@/modules/jev/JevControls';
import { JevFeed } from '@/modules/jev/JevFeed';
import { JevNet } from '@/modules/jev/JevNet';
import { JevReference } from '@/modules/jev/JevReference';
import { JevSection } from '@/modules/jev/JevSection';
import { useJevPanel } from '@/modules/jev/useJevPanel';
import type { JevRange } from '@/shared/types';
import { Banner, Button, EmptyState, ScrollArea, Spinner, Tooltip } from '@/shared/ui';
import { JevLogo } from '@/shared/ui/JevLogo';

/**
 * The Jev view of the API tab: what asking costs, what it saves, who asks most, and the switches that govern it.
 *
 * ORDERED THE WAY THE OPERATOR ASKED. Balance and burn first, with what Jev saves BESIDE it on a wide
 * panel so "is it worth it" reads as one comparison; then the biggest consumers, the range picker on
 * that section because it is the one whose numbers a range changes; then the feed; then the
 * controls; then the reference. Every section is a titled block in the one scroll.
 *
 * FOUR NON-DENSE STATES, EACH ITS OWN FACT. Not asked yet is a spinner; a reader that could not be
 * asked is a plug-out with the reason and the way back; a ledger that has never been written is an
 * empty state over the controls — the switches are the answer to "why not" — and a poll that fails
 * after a good read keeps the last summary under a warn line rather than blanking the screen.
 */
export function JevPanel() {
  const { t } = useTranslation();
  const [range, setRange] = useState<JevRange>('7d');
  const [caller, setCaller] = useState<string | null>(null);
  const { data, loading, error, refresh } = useJevPanel(range);
  // The window is the question: moving it is all this press does, and the hook asks again the moment
  // it moves rather than at the next tick, so no frame draws the last window under the new label.
  const onRangeChange = (next: JevRange) => setRange(next);
  const onRefresh = () => { void refresh(); };
  // A caller pressed in the consumers table filters the feed and carries the reader to it.
  const onPickCaller = (next: string) => {
    setCaller(next);
    document.getElementById('jev-feed')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };
  const refreshLabel = t('jev.refresh', { defaultValue: 'Refresh' });

  return (
    <div className="flex h-full flex-col [container-type:inline-size]" data-jev-panel>
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10">
          <JevLogo className="h-4 w-4" />
        </span>
        <h2 className="text-sm font-medium">{t('jev.title', { defaultValue: 'Jev' })}</h2>
        <div className="ml-auto">
          <Tooltip content={refreshLabel} position="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
              aria-label={refreshLabel}
              disabled={loading}
              onClick={onRefresh}
              data-jev-refresh
            >
              <RefreshCwIcon aria-hidden="true" />
            </Button>
          </Tooltip>
        </div>
      </header>

      {data === null && loading ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <Spinner label={t('jev.reading', { defaultValue: 'Asking the Jev reader…' })} />
        </div>
      ) : data === null ? (
        <div className="flex flex-1 items-center justify-center px-4 py-10">
          <EmptyState
            icon={PlugZapIcon}
            title={t('jev.unreachable.title', { defaultValue: 'The Jev reader could not be asked' })}
            message={error ?? undefined}
            actionLabel={t('jev.unreachable.retry', { defaultValue: 'Try again' })}
            onAction={onRefresh}
          />
        </div>
      ) : (
        <ScrollArea className="min-h-0 flex-1">
          {error && <Banner tone="warn">{error}</Banner>}
          <div className="flex w-full min-w-0 flex-col gap-8 px-4 py-5 [@container(min-width:48rem)]:px-6" data-jev-body>
            {!data.ledger.present ? (
              <EmptyState
                title={t('jev.empty.title', { defaultValue: 'Jev has not been called yet' })}
                message={t('jev.empty.message', { defaultValue: 'The first ask writes the ledger. The switches below are what let one happen.' })}
              />
            ) : (
              <>
                <div className="grid gap-8 [@container(min-width:48rem)]:grid-cols-2">
                  <JevSection id="jev-burn" title={t('jev.sections.burn', { defaultValue: 'Balance and burn' })}>
                    <JevBurn balance={data.balance} spend={data.spend} days={data.days} />
                  </JevSection>
                  <JevSection id="jev-net" title={t('jev.sections.net', { defaultValue: 'What Jev saves' })} hint={t('jev.sections.netHint', { defaultValue: 'all time' })}>
                    <JevNet net={data.net} />
                  </JevSection>
                </div>
                <JevSection id="jev-consumers" title={t('jev.sections.consumers', { defaultValue: 'Biggest consumers' })}>
                  <JevConsumers consumers={data.consumers} top={data.top} totals={data.totals} range={range} onRangeChange={onRangeChange} onPickCaller={onPickCaller} />
                </JevSection>
                <JevSection id="jev-feed" title={t('jev.sections.feed', { defaultValue: 'What Jev is doing now' })}>
                  <JevFeed feed={data.feed} caller={caller} onClearCaller={() => setCaller(null)} />
                </JevSection>
              </>
            )}
            <JevSection id="jev-controls" title={t('jev.sections.controls', { defaultValue: 'Switches, cache, counters and no-send' })}>
              <JevControls cache={data.cache} budget={data.budget} noSend={data.no_send} onCleared={onRefresh} />
            </JevSection>
            {data.ledger.present && (
              <JevSection id="jev-reference" title={t('jev.sections.reference', { defaultValue: 'Who calls Jev' })}>
                <JevReference reference={data.reference} />
              </JevSection>
            )}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}
