import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { toTimelineEvent } from '@/modules/cerberus/utils/activityEvents';
import type { CerberusActivity } from '@/shared/cerberus-types';
import { Card, Timeline } from '@/shared/ui';
import { cn } from '@/shared/utils';

type WhatHappenedCardProps = {
  /** The overview's newest lines of "What happened", newest first: seven at most. */
  activity: CerberusActivity[];
  /** The read's own moment: a line from today reads its time, an older one its date as well. */
  now: number;
};

/**
 * WHAT HAPPENED: the fleet's newest lines beside it, one row each in the kit's dense `Timeline` — a
 * dot in the line's tone, where it came from, what happened, when — and a row opens to its detail.
 * Each line is worded once, for this card and History alike, by `toTimelineEvent`: "Session is valid
 * is failing", "Import backlog is clear muted until 18:40", "Mute lifted · …", "node-5 enrolled".
 *
 * The blip beside the title is the accent, ringing once whenever a newer line arrives at the head; it
 * is grey and still while nothing has happened yet, which the card then says in words.
 *
 * Used by Fleet's `FleetView`: beside the fleet at desktop widths, under it on a phone.
 */
export function WhatHappenedCard({ activity, now }: WhatHappenedCardProps) {
  const { t } = useTranslation();
  // The lines as Timeline rows: worded once, by the same function History's feed uses.
  const events = useMemo(() => activity.map((line) => toTimelineEvent(line, t, now)), [activity, t, now]);
  // What a line is, apart from where it stands in the list: when, what kind, on which node and check, which
  // event of it, and which run or entry. A `catalog` line is about no node or check, so both read empty for
  // it; the event and the run or entry tell apart two lines of one run in one millisecond (a run that fails
  // to send is asked for and ended in the same one) and every catalog line of a moment.
  const lineKey = (line: CerberusActivity): string =>
    [
      line.at,
      line.kind,
      'node' in line ? line.node : '',
      'check' in line ? line.check : '',
      'event' in line ? line.event : '',
      'runId' in line ? line.runId : 'entry' in line ? line.entry : '',
    ].join(':');
  // The line whose row is open to its detail, by what the line IS and not by its place: a newer line
  // arriving at the head pushes every row down, and a position would leave the detail under a different
  // event. Null while none is open. A line pushed past the seven stops matching, so its row is closed.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const openAt = openKey === null ? -1 : activity.findIndex((line) => lineKey(line) === openKey);
  const openIndex: number | null = openAt === -1 ? null : openAt;
  // Opens the pressed row, or closes it when it is the open one.
  const onToggle = (index: number) => {
    const line = activity[index];
    if (line === undefined) return;
    const key = lineKey(line);
    setOpenKey((current) => (current === key ? null : key));
  };

  const newest = activity[0];
  // Keyed by the newest line, the blip is a new element when a newer one arrives, and rings again.
  const newestKey = newest === undefined ? 'none' : lineKey(newest);

  return (
    <Card className="px-[18px] py-4">
      <h2 className="mb-2 flex items-center text-xs uppercase tracking-[.14em] text-ink-faint">
        {t('cerberus.activity.title')}
        <span
          key={newestKey}
          aria-hidden
          className={cn('ml-2.5 size-[7px] rounded-full', newest === undefined ? 'bg-input' : 'bg-primary motion-safe:animate-[vv-ring_1.2s_ease-out_1]')}
        />
      </h2>
      {events.length > 0 ? (
        <Timeline events={events} density="dense" openIndex={openIndex} onToggle={onToggle} />
      ) : (
        <p className="text-[13.5px] text-muted-foreground">{t('cerberus.activity.nothingYet')}</p>
      )}
    </Card>
  );
}
