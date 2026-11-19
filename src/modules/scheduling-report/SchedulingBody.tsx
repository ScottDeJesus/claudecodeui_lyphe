import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { EntryList } from '@/modules/scheduling-report/EntryList';
import { SchedulingKindList } from '@/modules/scheduling-report/SchedulingKindList';
import { SchedulingOpeners } from '@/modules/scheduling-report/SchedulingOpeners';
import type { SchedulingFilters, SchedulingRead } from '@/modules/scheduling-report/utils/schedulingModel';
import type { SchedulingOverview } from '@/shared/scheduling-report-types';
import { Badge, HowOften } from '@/shared/ui';

type SchedulingBodyProps = {
  /** The window as the server answered it. */
  overview: SchedulingOverview;
  /** The whole read: the body draws its buckets (days, hours). */
  read: SchedulingRead;
  filters: SchedulingFilters;
  now: number;
  onFilter: (filters: SchedulingFilters) => void;
  onOpenEntry: (id: string) => void;
};

/**
 * THE BODY: By what was done, How often and Where it starts on the left, Sessions on the right.
 *
 * TWO COLUMNS ONCE THE VIEW ITSELF IS 48rem WIDE, never the window: the root is a size container, so a Cerberus tab
 * squeezed by the sidebar stacks instead of clipping its rows (the heal panel's own rule and its own number). The left
 * column is the narrower (2fr to the sessions' 3fr): its rows are counts, the sessions' rows are sentences. Narrower,
 * everything is one column in the same order, kinds, how often, where it starts, sessions, which is the order a phone
 * reads them in. The columns flow in the tab's own scroll; nothing here scrolls inside itself.
 *
 * Each section is addressable by id, so a pill can carry the reader to it, and is headed by the tab's eyebrow with a
 * short hint of how to read it.
 *
 * THE SESSIONS BADGE IS THE LIST'S OWN NUMBER. Speed bumps only is applied here, once, and the same entries are counted
 * for the badge and handed to the list, so the badge never says 31 over ten rows. People's sessions are counted apart
 * from machine calls ("31 + 2 machine calls"), so with Machine calls on the badge still agrees with the head, whose
 * figures leave them out. Speed bumps only lists people's alone: a machine's call is never a speed bump of the view.
 *
 * Used by this module's root, `SchedulingView`, under the pills.
 */
export function SchedulingBody({ overview, read, filters, now, onFilter, onOpenEntry }: SchedulingBodyProps) {
  const { t } = useTranslation();
  const s = 'cerberus.scheduling.sections';
  const listed = filters.bumpsOnly ? overview.entries.filter((entry) => entry.verdict === 'hiccup' && entry.actor_kind === 'person') : overview.entries;
  const machines = listed.filter((entry) => entry.actor_kind === 'machine').length;
  const sessions = listed.length - machines;
  const badge = listed.length === 0 ? undefined : machines === 0 ? String(sessions) : t(`${s}.sessionsWithMachines`, { sessions, count: machines });

  return (
    // The classes are written whole, one per rule, since Tailwind reads them as text: the 48rem line is the heal panel's.
    <div
      className="flex min-w-0 flex-col gap-7 [@container(min-width:48rem)]:grid [@container(min-width:48rem)]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [@container(min-width:48rem)]:items-start [@container(min-width:48rem)]:gap-x-8"
      data-scheduling-body
    >
      <div className="flex min-w-0 flex-col gap-7" data-scheduling-column="left">
        <SchedulingSection id="scheduling-kinds" title={t(`${s}.kinds`)} hint={t(`${s}.kindsHint`)}>
          <SchedulingKindList kinds={overview.kinds} entries={overview.entries} now={now} onOpenEntry={onOpenEntry} />
        </SchedulingSection>
        <SchedulingSection id="scheduling-often" title={t(`${s}.often`)} hint={t(`${s}.oftenHint`)}>
          <HowOften days={read.days} hours={read.hours} words="cerberus.scheduling.often" />
        </SchedulingSection>
        <SchedulingSection id="scheduling-starts" title={t(`${s}.starts`)} hint={t(`${s}.startsHint`)}>
          <SchedulingOpeners openers={overview.openers} entries={overview.entries} />
        </SchedulingSection>
      </div>
      <SchedulingSection id="scheduling-sessions" title={t(`${s}.sessions`)} hint={t(`${s}.sessionsHint`)} badge={badge}>
        <EntryList overview={overview} entries={listed} filters={filters} onFilter={onFilter} onOpenEntry={onOpenEntry} />
      </SchedulingSection>
    </div>
  );
}

/** A titled block of the body, addressable by id so a pill can carry the reader to it. Its hint is set apart by space, with no dot of its own: when it wraps under the title, no stray mark leads its line. */
function SchedulingSection({ id, title, hint, badge, children }: { id: string; title: string; hint: string; badge?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 scroll-mt-4 flex-col gap-3" data-scheduling-section={id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`${id}-title`} className="text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
        {badge !== undefined && <Badge as="span" tone="neutral">{badge}</Badge>}
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </section>
  );
}
