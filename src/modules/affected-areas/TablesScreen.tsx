import { useState } from 'react';

import { useProving } from '@/modules/affected-areas/hooks/useProving';
import { ProvingTable } from '@/modules/affected-areas/ProvingTable';
import { answerOfWrite } from '@/modules/affected-areas/utils/laneTrouble';
import { sameLine } from '@/modules/affected-areas/utils/provingModel';
import type { ProvingClass } from '@/shared/affected-areas-types';
import { api } from '@/shared/api';

type TablesScreenProps = {
  /**
   * Whether the table is on view: the Tours · Mark · Tables switch shows Tables and the Tours view itself is shown.
   * Passed by the view root, which keeps this screen mounted while Tours or Mark shows, so the table is read again
   * each time this turns true: marks made on Mark move its numbers.
   */
  shown: boolean;
};

/**
 * The sort the table opens on: precision, lowest first. The kinds whose line most needs the operator stand at the top,
 * and a kind with no percentage yet (too thin, or never judged) sinks below every kind that has one.
 */
const FIRST_SORT = { column: 'precision', direction: 'asc' } as const;

/** The columns whose first press sorts lowest first: the kind A to Z, and the two shares whose low end needs the operator. Every count opens highest first. */
const ASCENDING_FIRST: readonly string[] = ['kind', 'precision', 'coverage'];

/** The steps in a whole line: the stepper moves in twentieths (0.05 on the wire, five points said in percent). */
const STEPS_PER_LINE = 20;

/**
 * THE TABLES: how right the reader is, kind by kind, measured on the random slice, and where each kind's line sits.
 *
 * This file holds what the screen does and `ProvingTable` draws it. One read answers the whole table, `GET /proving`
 * for the pinned model on the current contract: the screen sorts it and never computes a number of its own. A row
 * opens to its sweep and its line's control; Set threshold sends `PUT /thresholds/{kind}`, and the kind it answers
 * replaces its row, so the line, its date and its numbers are redrawn from the engine's answer, never worked out here.
 *
 * Used by the affected-areas module's view root, under its Tours · Mark · Tables switch.
 */
export function TablesScreen({ shown }: TablesScreenProps) {
  // The table: read the first time `shown` turns true, again, quietly (the table stays on screen), each time it turns
  // true after, and on Try again; never on a timer, and never while the screen is hidden.
  const proving = useProving(shown);
  // The column the table is sorted by and which way. Held here: the table sorts, the screen chooses.
  const [sort, setSort] = useState<{ column: string; direction: 'asc' | 'desc' }>(FIRST_SORT);
  // The kind open under its row, by its key; null when none is. One at a time: the sweep and the line are one kind's.
  const [expanded, setExpanded] = useState<string | null>(null);
  // The rows as they stood when the open row opened, or when a head was last pressed while it was open. While they are
  // held the table sorts by them, so Set threshold's answer redraws its row in place: a re-sort would move the open
  // row, and the panel under the operator's finger.
  const [heldFrom, setHeldFrom] = useState<ProvingClass[] | null>(null);
  // Where the open kind's stepper stands; null while it stands at the line in force. Set threshold sends it.
  const [line, setLine] = useState<number | null>(null);
  // Whether Set threshold's press is out: the press waits, and the stepper holds still, until the answer.
  const [pressing, setPressing] = useState(false);
  // Why the last Set threshold set no line: the engine's reason code (`not_a_person`, `bad_class`, `bad_threshold`) or
  // the lane's trouble (`unreachable`, `no_secret`, `unreadable`, `failed`); null when none stands.
  const [refusal, setRefusal] = useState<string | null>(null);

  const rows = proving.value?.classes ?? null;
  const openKind = rows?.find((kind) => kind.class === expanded) ?? null;

  // A pressed head sorts by its column. A new column opens on the end that needs the operator first, precision and
  // coverage lowest first, every count highest first, the kind A to Z; pressing the sorted column flips it. While a row
  // is open, a press re-takes the held rows as they stand now, so the table shows the order asked for by today's
  // figures and the next answer still redraws in place; with no row open it lets them go.
  const onSort = (column: string): void => {
    setSort((current) => {
      if (current.column === column) return { column, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      return { column, direction: ASCENDING_FIRST.includes(column) ? 'asc' : 'desc' };
    });
    setHeldFrom(expanded === null ? null : rows);
  };
  // A pressed row opens, or closes when it is the open one (the table says which). Either way the stepper goes back to
  // the line in force and a refusal still standing is cleared: both were the last kind's. Opening a row while none are
  // held holds the rows as they stand now; opening another keeps the rows held, so the order on screen stays; closing
  // lets them go.
  const onExpand = (key: string | null): void => {
    setExpanded(key);
    setLine(null);
    setRefusal(null);
    setHeldFrom(key === null ? null : heldFrom ?? rows);
  };
  // A step moves the stepper's line 0.05 down (-1) or up (1) from where it stands (the line in force while `line` is
  // null), kept within 0 and 1 and rounded to the step, so steps never drift off 0.05s.
  const onStep = (direction: -1 | 1): void => {
    if (openKind === null || pressing) return;
    const moved = (line ?? openKind.threshold) + direction / STEPS_PER_LINE;
    setLine(Math.round(Math.min(1, Math.max(0, moved)) * STEPS_PER_LINE) / STEPS_PER_LINE);
  };
  // Set threshold, for the open kind at the stepper's line: one press at a time. Its answer, the kind as it now stands,
  // replaces the kind's row and `line` goes back to null; a refusal's code, or the lane's trouble when no answer came,
  // goes to `refusal`. The press would change nothing when the line is the one in force and was set by a person: the
  // control refuses it (`aria-disabled`) before it gets here, and so does this guard.
  const onSetThreshold = (): void => {
    if (openKind === null || pressing || (!openKind.isDefault && sameLine(line ?? openKind.threshold, openKind.threshold))) return;
    const { class: key } = openKind;
    const threshold = line ?? openKind.threshold;
    setPressing(true);
    setRefusal(null);
    void answerOfWrite<ProvingClass>(() => api.affectedAreas.setThreshold(key, { threshold })).then((result) => {
      setPressing(false);
      if ('refusal' in result) {
        setRefusal(result.refusal);
        return;
      }
      proving.replaceClass(result.answer);
      setLine(null);
    });
  };

  return (
    <ProvingTable
      proving={proving}
      sort={sort}
      onSort={onSort}
      expanded={expanded}
      onExpand={onExpand}
      heldFrom={heldFrom}
      line={line}
      pressing={pressing}
      refusal={refusal}
      onStep={onStep}
      onSetThreshold={onSetThreshold}
    />
  );
}
