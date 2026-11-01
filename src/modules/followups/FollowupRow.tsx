import { useTranslation } from 'react-i18next';

import type { Followup } from '@/shared/types';
import { Checkbox } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/** What a `closedFor` names: an epic (`epic:<epic>`), or a feature with the task key of one of its tasks when a task finished (`<feature>`, `<feature>/<task key>`). */
type ClosedForNames = { epic: string } | { feature: string; task: string | null };

/** The `closedFor` prefix of an item an epic's finish closed; a slug holds no colon, so no feature name starts with it. */
const EPIC_PREFIX = 'epic:';

/**
 * `closedFor` as what it names, or `null` when there is none. The epic prefix is tested BEFORE the slash split, so the
 * name after it is the epic's whole name; a feature closure is split on its first `/` (a feature name has none).
 */
function splitClosedFor(closedFor: string | null): ClosedForNames | null {
  // `typeof`, not `=== null`: a build served before the server restarts reads rows that have no `closedFor` at all.
  if (typeof closedFor !== 'string') return null;
  if (closedFor.startsWith(EPIC_PREFIX)) {
    const epic = closedFor.slice(EPIC_PREFIX.length);
    return epic === '' ? null : { epic };
  }

  const slash = closedFor.indexOf('/');
  const feature = slash === -1 ? closedFor : closedFor.slice(0, slash);
  if (feature === '') return null;
  return { feature, task: slash === -1 ? null : closedFor.slice(slash + 1) };
}

/**
 * One item of the Next steps widget: the line, a muted age under it, and the tick.
 *
 * Used by `FollowupsWidgetBody`, for the open groups and the Done fold alike. The tick is Verve's `Checkbox` — a real
 * input, so Tab reaches it and Space toggles it — and its label is the line itself, so a press anywhere on the words
 * ticks the row and a screen reader hears the line with its state. The line is plain text (never markdown or HTML) and
 * wraps, long unbroken text included (`.vv-checkbox__label` breaks anywhere). A done row shows when it was settled;
 * an open row shows how long it has been open. A row the house closed when the feature, task or epic it named finished
 * says so: `closedFor` is `<feature>`, `<feature>/<task key>` or `epic:<epic>` (`splitClosedFor`). Under a finger (a touch
 * screen, or a window under 768 px) the tick's row is a 44 px catch, the house's touch floor: the station's follow-ups stage
 * draws these rows on a phone, upright and on its side.
 */
export function FollowupRow({ item, onToggle }: { item: Followup; onToggle: (id: number, done: boolean) => void }) {
  const { t } = useTranslation();
  const done = item.state === 'done';
  const when = formatRelativeTime(item.doneAt);
  const finished = item.closedBy === 'completion' ? splitClosedFor(item.closedFor) : null;
  const doneLine =
    finished === null
      ? t('followups.doneWhen', { when })
      : 'epic' in finished
        ? t('followups.doneWhenEpicFinished', { when, epic: finished.epic })
        : finished.task === null
          ? t('followups.doneWhenFeatureFinished', { when, feature: finished.feature })
          : t('followups.doneWhenTaskFinished', { when, task: finished.task, feature: finished.feature });

  return (
    <li data-followup data-followup-id={item.id} data-followup-kind={item.kind} data-followup-state={item.state} className="min-w-0">
      <Checkbox
        className="items-start py-1 finger:min-h-11 finger:py-2.5"
        checked={done}
        label={item.text}
        onChange={(next) => onToggle(item.id, next)}
      />
      <span data-followup-age className="block pl-[30px] text-xs text-muted-foreground">
        {done ? doneLine : formatRelativeTime(item.createdAt)}
      </span>
    </li>
  );
}
