import { PlugZapIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GeminiBudgets } from '@/modules/gemini-spend/GeminiBudgets';
import { GeminiDays } from '@/modules/gemini-spend/GeminiDays';
import { GeminiDoorDown } from '@/modules/gemini-spend/GeminiDoorDown';
import { daysOf, keysOf, usdWords } from '@/modules/gemini-spend/geminiFigures';
import { GeminiKeys } from '@/modules/gemini-spend/GeminiKeys';
import { GeminiProjectSection } from '@/modules/gemini-spend/GeminiProjectSection';
import { GeminiRow, GeminiRows } from '@/modules/gemini-spend/GeminiRow';
import { GeminiTotal } from '@/modules/gemini-spend/GeminiTotal';
import type { GeminiDoor, GeminiRange } from '@/modules/gemini-spend/types';
import { useGeminiUsage } from '@/modules/gemini-spend/useGeminiUsage';
import { SCREEN_FRAME } from '@/shared/constants';
import { Banner, Button, EmptyState, Rule, ScrollArea, SegmentedControl, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

const WINDOWS: GeminiRange[] = ['today', '7d', '30d'];

/**
 * The API tab's Gemini sub-tab: what Gemini cost, who asked, and the switch beside each asker.
 *
 * Top to bottom, in the order the questions come: the window; what it cost (the one large figure, its basis and when it was read under it,
 * its three series beside it); when (the days, each door's in its own plot); who (Restorly, shadow-connector and CloudCLI, each feature with its
 * switch at the end of its own row); what building cost (builds and sessions, no switch); and on which key and from
 * which process, for the day Google's figure for a key and this one disagree.
 *
 * EVERY STATE IS A DRAWING OF ITS OWN. The window control stands in all of them, so the way out of a bad read is in
 * reach. The first read is the Spinner. Both doors down is one sentence each and one press to ask again. One door down
 * is its sentence in that door's place, the total saying beside its figure that it is short, and the other door drawn
 * whole. A window nothing was asked in keeps every catalog row and its switch, at "No calls". A press a door refused is
 * said in a bar pinned over the scrolling body, in sight of the switch that was pressed wherever it stands, with one press
 * beside it that puts the sentence away.
 *
 * Two doors in one snake_case row shape, read as served: the connector's /api/gemini-usage and CloudCLI's own
 * /api/gemini-meter. Composed from the kit alone; the module builds no control.
 */
export function GeminiUsagePanel() {
  const { t } = useTranslation();
  // The chosen window, the panel's own state; it opens on 7 days.
  const [range, setRange] = useState<GeminiRange>('7d');
  const view = useGeminiUsage(range);
  const onRangeChange = (next: GeminiRange) => setRange(next);
  const onSwitch = (door: GeminiDoor, feature: string, enabled: boolean) => view.setSwitch(door, feature, enabled);
  const onRetry = () => view.refresh();
  const onDismissPressFailure = () => view.dismissPressFailure();

  const windows = WINDOWS.map((value) => ({ value, label: t('api.gemini.window.' + value) }));
  const connector = view.connector.state === 'answered' ? view.connector.body : null;
  const meter = view.meter.state === 'answered' ? view.meter.body : null;
  const connectorSentence = view.connector.state === 'failed' ? view.connector.sentence : null;
  const meterSentence = view.meter.state === 'failed' ? view.meter.sentence : null;
  const firstRead = view.connector.state === 'reading' || view.meter.state === 'reading';
  const bothDown = connectorSentence !== null && meterSentence !== null;
  // The window the figures were read in: the answer's own.
  const shown = connector?.range ?? meter?.range ?? range;
  // The age of what is drawn: the older of the answers on the page.
  const readAt = [view.connector, view.meter].flatMap((door) => (door.state === 'answered' ? [door.readAt] : [])).sort()[0] ?? null;

  return (
    <div className="flex h-full flex-col [container-type:inline-size]" data-gemini-usage>
      {/* Pinned over the scrolling body: a refused press is said in sight of the switch that was pressed, wherever it stands.
          The status region is always mounted and empty, with no box of its own, so the sentence ARRIVES in a live region
          that was already on the page and is spoken; a region that mounts holding its words is not announced everywhere. */}
      <div className="shrink-0" role="status" data-gemini-status>
        {view.pressFailure && (
          <div className="border-b border-border" data-gemini-press-failed>
            <div className={cn(SCREEN_FRAME, 'py-3')}>
              <Banner
                tone="warn"
                action={
                  <Button variant="tonal" size="sm" className="shrink-0 finger:h-11" onClick={onDismissPressFailure}>
                    {t('api.gemini.pressDismiss')}
                  </Button>
                }
              >
                {t('api.gemini.pressFailed', { label: view.pressFailure.label, sentence: view.pressFailure.sentence })}
              </Banner>
            </div>
          </div>
        )}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        <div className={cn(SCREEN_FRAME, 'flex min-w-0 flex-col gap-8 py-5')} data-gemini-body>
          <h2 className="sr-only">{t('api.gemini.title')}</h2>
          <div className="flex min-w-0" data-gemini-window>
            <SegmentedControl options={windows} value={range} onChange={onRangeChange} label={t('api.gemini.window.label')} />
          </div>

          {firstRead ? (
            <div className="flex items-center justify-center px-4 py-16" data-gemini-reading>
              <Spinner label={t('api.gemini.reading')} />
            </div>
          ) : bothDown ? (
            <div className="flex items-center justify-center px-4 py-10" data-gemini-both-down>
              <EmptyState
                icon={PlugZapIcon}
                title={t('api.gemini.doorDown.both')}
                message={connectorSentence + ' ' + meterSentence}
                actionLabel={t('api.gemini.doorDown.retry')}
                onAction={onRetry}
              />
            </div>
          ) : (
            <>
              <GeminiTotal range={shown} connector={connector} meter={meter} readAt={readAt} />
              <GeminiDays days={daysOf(connector, meter)} connectorAnswered={connector !== null} meterAnswered={meter !== null} />

              {connector ? (
                connector.projects.map((project) => (
                  <GeminiProjectSection
                    key={project.project}
                    section={project.project}
                    title={t('api.gemini.projects.' + project.project)}
                    figure={usdWords(project.cost_usd)}
                    masterOff={project.master !== null && !project.master.enabled}
                    door="connector"
                    features={project.features}
                    held={view.held}
                    onSwitch={onSwitch}
                  />
                ))
              ) : (
                <GeminiDoorDown
                  section="connector"
                  title={t('api.gemini.projects.connector')}
                  sentence={t('api.gemini.doorDown.connector') + ' ' + (connectorSentence ?? '')}
                  onRetry={onRetry}
                />
              )}

              {meter ? (
                <GeminiProjectSection
                  section="cloudcli"
                  title={t('api.gemini.projects.cloudcli')}
                  figure={usdWords(meter.cost_usd)}
                  door="meter"
                  features={meter.features}
                  held={view.held}
                  onSwitch={onSwitch}
                />
              ) : (
                <GeminiDoorDown
                  section="cloudcli"
                  title={t('api.gemini.projects.cloudcli')}
                  sentence={t('api.gemini.doorDown.meter') + ' ' + (meterSentence ?? '')}
                  onRetry={onRetry}
                />
              )}

              {connector?.claude_login && (
                <section className="flex min-w-0 flex-col gap-3" aria-labelledby="gemini-claude-login" data-gemini-section="claude-login">
                  <Rule id="gemini-claude-login" end={t('api.gemini.claudeLogin.unpriced')}>
                    {t('api.gemini.claudeLogin.title')}
                  </Rule>
                  <p className="min-w-0 text-xs text-muted-foreground">{t('api.gemini.claudeLogin.note')}</p>
                  <GeminiRows>
                    {connector.claude_login.sites.map((site) => (
                      <GeminiRow
                        key={site.site}
                        name={site.label}
                        detail={site.models.length > 0 ? site.models.join(', ') : undefined}
                        calls={site.calls}
                        tokens={site.input_tokens + site.output_tokens}
                        costUsd={null}
                      />
                    ))}
                  </GeminiRows>
                </section>
              )}

              {connector && <GeminiBudgets budgets={connector.budgets} figure={usdWords(connector.budgets_usd)} />}
              <GeminiKeys keys={keysOf(connector, meter)} processes={connector ? connector.processes : null} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
