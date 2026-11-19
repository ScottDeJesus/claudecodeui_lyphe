import { FilterXIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EntryRow } from '@/modules/scheduling-report/EntryRow';
import { MachineCallsChip } from '@/modules/scheduling-report/MachineCallsChip';
import type { SchedulingFilters } from '@/modules/scheduling-report/utils/schedulingModel';
import { whoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import type { SchedulingEntry, SchedulingOverview } from '@/shared/scheduling-report-types';
import { Button, Chip, EmptyState } from '@/shared/ui';

type EntryListProps = {
  /** The window as the server answered it: the people who scheduled, and whether it was cut short. */
  overview: SchedulingOverview;
  /** The entries the list draws, newest first: the window's, less the clean ones while Speed bumps only is on. The body counts them for the section's badge, so the badge and the rows are one number. */
  entries: SchedulingEntry[];
  /** What the list is narrowed to. */
  filters: SchedulingFilters;
  onFilter: (filters: SchedulingFilters) => void;
  onOpenEntry: (id: string) => void;
};

/** How many rows are drawn before the reader asks for more. A window can hold two thousand entries; the newest are the ones looked for. */
const PAGE = 25;
const NO_FILTERS: SchedulingFilters = { by: null, machines: false, bumpsOnly: false };

/**
 * SESSIONS: every entry of the window, newest first, under the chips that narrow it.
 *
 * THE CHIPS, in two groups: who (Everyone and one chip per person who scheduled, with how many sessions each) and which
 * (Speed bumps only, and Machine calls, off until asked for, since a machine's call is in no figure of the view). The
 * groups are set apart by space alone and each wraps as one, so a narrow column never starts a line with a stray divider.
 * Each chip is a toggle that says whether it is on (`aria-pressed`); the people are data, so nobody's name is written here.
 *
 * THE PERSON CHOSEN ALWAYS HAS A CHIP. The server narrows its list of people to the one asked for, and to nobody when
 * that person has no session in the window: their chip is drawn all the same, lit, with a zero, so a list narrowed to
 * nothing still shows what it is narrowed to.
 *
 * THE STATES. A filter that matches nothing says so, with the press that clears it right there. A window with more
 * entries than one answer carries says the list is the newest of them. Only the newest 25 rows are drawn until Show more
 * is pressed, so a ninety-day window opens as fast as a week.
 *
 * Speed bumps only is the browser's own filter over the answer in hand, applied by the body before the entries reach
 * this list; the people and Machine calls are asked of the server, through `onFilter`.
 *
 * Used by this module's `SchedulingBody`, as the right column.
 */
export function EntryList({ overview, entries, filters, onFilter, onOpenEntry }: EntryListProps) {
  const { t } = useTranslation();
  const r = 'cerberus.scheduling.sessions';
  // How many rows are on screen: the list's own place, moved only by Show more, so it is held here and not at the root.
  const [limit, setLimit] = useState(PAGE);

  const shown = entries.slice(0, limit);
  const rest = entries.length - shown.length;
  const set = (change: Partial<SchedulingFilters>) => onFilter({ ...filters, ...change });
  // The person asked for, when the answer no longer lists them: their chip stands with a zero.
  const people = filters.by === null || overview.people.some((person) => person.actor === filters.by)
    ? overview.people
    : [...overview.people, { actor: filters.by, entries: 0 }];

  return (
    <div className="flex min-w-0 flex-col gap-3" data-scheduling-sessions>
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5" role="group" aria-label={t(`${r}.filters`)}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip size="sm" className="finger:min-h-11" selected={filters.by === null} onClick={() => set({ by: null })}>{t(`${r}.everyone`)}</Chip>
          {people.map((person) => (
            <Chip key={person.actor} size="sm" className="max-w-full finger:min-h-11" selected={filters.by === person.actor} onClick={() => set({ by: person.actor })} title={person.actor}>
              <span className="min-w-0 break-words">{whoWord(t, person.actor)}</span> <span className="tabular-nums text-muted-foreground">{person.entries}</span>
            </Chip>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip size="sm" className="finger:min-h-11" selected={filters.bumpsOnly} onClick={() => set({ bumpsOnly: !filters.bumpsOnly })}>{t(`${r}.bumpsOnly`)}</Chip>
          <MachineCallsChip selected={filters.machines} onToggle={() => set({ machines: !filters.machines })} />
        </div>
      </div>

      {overview.truncated && <p className="text-xs text-muted-foreground" data-scheduling-truncated>{t(`${r}.truncated`, { count: overview.entries.length })}</p>}

      {entries.length === 0 ? (
        // The filters match nothing: the chips stay above, and the way back is the action.
        <EmptyState size="sm" icon={FilterXIcon} title={t(`${r}.noMatch`)} actionLabel={t(`${r}.clear`)} onAction={() => onFilter(NO_FILTERS)} />
      ) : (
        <>
          <ul className="flex min-w-0 flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {shown.map((entry) => <EntryRow key={entry.id} entry={entry} onOpenEntry={onOpenEntry} />)}
          </ul>
          {rest > 0 && (
            <Button variant="outline" size="sm" className="h-8 self-start max-md:h-11" onClick={() => setLimit((count) => count + PAGE)}>
              {rest <= PAGE ? t(`${r}.more`, { count: rest }) : t(`${r}.moreOf`, { count: PAGE, rest })}
            </Button>
          )}
        </>
      )}
    </div>
  );
}
