import { ArrowUpCircle, Bell, Plus } from 'lucide-react';
import { Fragment, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { useClock } from '@/modules/cerberus/hooks/useClock';
import { useCountTo } from '@/modules/cerberus/hooks/useCountTo';
import { toTimelineEvent } from '@/modules/cerberus/utils/activityEvents';
import { hm, hms } from '@/modules/cerberus/utils/cerberusTime';
import { agoPhrase, muteTimeLeft } from '@/modules/cerberus/utils/fleetWords';
import { batchPlace, canTake } from '@/modules/cerberus/utils/wardenUpdates';
import type { CerberusOverview, CerberusWardens } from '@/shared/cerberus-types';
import { useWebSocket } from '@/shared/context/WebSocketContext';
import { Button, IconWord, Rule } from '@/shared/ui';
import { cn } from '@/shared/utils';

type FleetOpeningProps = {
  /** The fleet as center last answered it. */
  overview: CerberusOverview;
  /** The fleet is the last answer center gave: no read has answered for 90 s, so the live line stops saying Live. */
  stale: boolean;
  /** Where the fleet's wardens stand against the release on offer, null until a read answers. */
  wardens: CerberusWardens | null;
  /** Enroll a node, pressed: the panel opens its Enroll dialog. */
  onEnroll: () => void;
  /** The update press: the panel opens its Update wardens dialog. */
  onUpdateWardens: () => void;
};

/**
 * THE FLEET, opened from Cerberus's core: what the old header and the What happened card said, as one quiet column under the
 * Opening's title (the fleet's answer, `fleetHeadline`).
 *
 * 1. The summary: "18 of 21 checks passing · 2 muted · 6 nodes · last result 2 s ago", the passing count counting to a new number
 *    over 1.4 s when it changes (a screen reader hears only where it lands).
 * 2. The live line: the positive dot breathing beside "Live" and the time to the second while the socket is up and the fleet is this
 *    minute's; the still neutral dot and "Reconnecting" otherwise. A monitor that cannot see never looks live.
 * 3. Its acts: the wardens' update ("Update wardens to 0.4.3", "Updating wardens · 2 of 3", "Wardens up to date"), drawn once the
 *    wardens read has answered with a release; and Enroll a node, its plus alone under a finger.
 * 4. Muted (n), while any check is: each with what it is, until when and why, and Unmute.
 * 5. What happened: the fleet's newest lines as a Trace, each in its own tone, the newest bead lit.
 *
 * Drawn by the panel (`CerberusPanel`) inside the core's Opening.
 */
export function FleetOpening({ overview, stale, wardens, onEnroll, onUpdateWardens }: FleetOpeningProps) {
  const { t } = useTranslation();
  const { counts } = overview;
  const { isConnected: connected } = useWebSocket();
  const { liftMute } = useCerberus();
  // The live line's time and the summary's "last result 12 s ago" count from this one clock.
  const now = useClock();
  const shownPassing = useCountTo(counts.passing);
  const live = connected && !stale;

  const place = batchPlace(wardens?.running ?? []);
  const updateWords = wardens?.latest == null
    ? null
    : place !== null
      ? t('cerberus.updates.button.updating', { index: place.index, total: place.of })
      : wardens.nodes.some(canTake)
        ? t('cerberus.updates.button.update', { version: wardens.latest.version })
        : t('cerberus.updates.button.upToDate');
  const rest = [
    counts.muted > 0 ? { id: 'muted', words: t('cerberus.header.summary.muted', { count: counts.muted }) } : null,
    { id: 'nodes', words: t('cerberus.header.summary.nodes', { count: counts.nodes }) },
    overview.lastResultAt === null ? null : { id: 'age', words: t('cerberus.header.summary.lastResult', { ago: agoPhrase(t, overview.lastResultAt, now) }) },
  ].filter((part): part is { id: string; words: string } => part !== null);

  const muted = overview.muted.flatMap((check) => (check.mute === null ? [] : [{ check, mute: check.mute }]));
  const events = useMemo(() => overview.activity.map((line) => toTimelineEvent(line, t, overview.now)), [overview.activity, overview.now, t]);
  const enroll = t('cerberus.header.enroll');

  return (
    <div className="cerberus-opening flex flex-col gap-4" data-cerberus-fleet-opening="">
      <p className="text-[13px] tabular-nums text-muted-foreground">
        <span className="whitespace-nowrap">
          <span className="sr-only">{counts.passing}</span>
          <span aria-hidden className="font-medium text-foreground">{shownPassing}</span>{' '}
          {t('cerberus.header.summary.of', { count: counts.checks })} ·
        </span>
        {rest.map((part, index) => (
          <Fragment key={part.id}>
            {' '}
            <span className="whitespace-nowrap">{index < rest.length - 1 ? `${part.words} ·` : part.words}</span>
          </Fragment>
        ))}
      </p>

      <p className="flex items-center gap-2 text-[12.5px] tabular-nums text-muted-foreground" data-cerberus-live={live ? 'true' : 'false'}>
        <span aria-hidden data-tone={live ? 'positive' : 'neutral'} className={cn('size-[7px] flex-none rounded-full bg-tone-dot', live && 'motion-safe:animate-cerberus-breathe')} />
        <span role="status">{live ? t('cerberus.header.live') : t('cerberus.header.reconnecting')}</span>
        {live && <span className="font-medium text-foreground">{hms(now)}</span>}
      </p>

      <div className="flex flex-wrap gap-2">
        {updateWords !== null && (
          <Button variant="outline" size="sm" className="finger:size-11 finger:px-0" aria-label={updateWords} title={updateWords} onClick={onUpdateWardens}>
            <IconWord icon={ArrowUpCircle} word={updateWords} />
          </Button>
        )}
        <Button variant="outline" size="sm" className="gap-1.5 finger:size-11 finger:px-0" aria-label={enroll} title={enroll} onClick={onEnroll} data-cerberus-enroll="">
          <Plus aria-hidden="true" className="size-4" />
          <span className="finger:hidden">{enroll}</span>
        </Button>
      </div>

      {muted.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <Rule level={4}>{t('cerberus.needs.mutedTitle', { count: muted.length })}</Rule>
          <ul className="flex flex-col gap-2.5">
            {muted.map(({ check, mute }) => (
              <li key={mute.id} className="flex items-center gap-2.5">
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] text-foreground [overflow-wrap:anywhere]">
                    {t('cerberus.needs.mutedItem', { label: check.label ?? check.key, service: check.serviceLabel ?? check.service })}
                  </div>
                  <div className="text-[12px] text-muted-foreground">
                    {t('cerberus.needs.mutedMeta', { time: hm(mute.until), left: muteTimeLeft(t, mute.until, now), reason: mute.reason })}
                  </div>
                </div>
                <Button variant="outline" size="sm" className="finger:size-11 finger:px-0" aria-label={t('cerberus.needs.unmute')} title={t('cerberus.needs.unmute')} onClick={() => void liftMute(mute.id)}>
                  <IconWord icon={Bell} word={t('cerberus.needs.unmute')} />
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {events.length > 0 && (
        <section className="flex flex-col gap-3">
          <Rule level={4}>{t('cerberus.activity.title')}</Rule>
          <ul className="ast-trace cerberus-trace">
            {events.map((event, index) => (
              <li key={`${index}:${event.when}:${event.title}`} className="ast-trace-item" data-latest={index === 0 ? 'true' : undefined}>
                <span className="ast-trace-bead" data-tone={event.tone} aria-hidden="true" />
                <span className="ast-trace-head">
                  <span className="ast-trace-src">{event.source}</span>
                  <span>{event.when}</span>
                </span>
                <p className="ast-trace-text">{event.title}</p>
                {event.summary !== undefined && <p className="m-0 text-[12px] leading-[17px] text-muted-foreground [overflow-wrap:anywhere]">{event.summary}</p>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
