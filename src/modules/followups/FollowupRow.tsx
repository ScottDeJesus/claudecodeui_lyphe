import { useTranslation } from 'react-i18next';

import type { Followup } from '@/shared/types';
import { Checkbox } from '@/shared/ui';
import { formatRelativeTime } from '@/shared/utils';

/**
 * One item of the Next steps widget: the line, a muted age under it, and the tick.
 *
 * Used by `FollowupsWidgetBody`, for the open groups and the Done fold alike. The tick is Verve's `Checkbox` — a real
 * input, so Tab reaches it and Space toggles it — and its label is the line itself, so a press anywhere on the words
 * ticks the row and a screen reader hears the line with its state. The line is plain text (never markdown or HTML) and
 * wraps, long unbroken text included (`.vv-checkbox__label` breaks anywhere). A done row shows when it was settled;
 * an open row shows how long it has been open.
 */
export function FollowupRow({ item, onToggle }: { item: Followup; onToggle: (id: number, done: boolean) => void }) {
  const { t } = useTranslation();
  const done = item.state === 'done';

  return (
    <li data-followup data-followup-id={item.id} data-followup-kind={item.kind} data-followup-state={item.state} className="min-w-0">
      <Checkbox
        className="items-start py-1"
        checked={done}
        label={item.text}
        onChange={(next) => onToggle(item.id, next)}
      />
      <span data-followup-age className="block pl-[30px] text-xs text-muted-foreground">
        {done ? t('followups.doneWhen', { when: formatRelativeTime(item.doneAt) }) : formatRelativeTime(item.createdAt)}
      </span>
    </li>
  );
}
