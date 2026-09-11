import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Meter } from '@/shared/ui';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type TaskProgressProps = {
  /** How many items `readListItems` found checked. Counted from the tree, never from the text. */
  done: number;
  /** Every item in the list. The rung only fires when all of them are tasks, so this is the floor. */
  total: number;
  collapseKey: string;
  /** The list exactly as react-markdown rendered it, `PlainList` wrapper and checkboxes included. */
  children: ReactNode;
};

/**
 * A GFM task list with its own progress line above it.
 *
 * Used by `elements/list.tsx` and nothing else. It adds a header and draws the list underneath it
 * UNCHANGED: the caller hands the already-wrapped `PlainList` as `children`, so every item, every
 * nested list and every one of remark-gfm's own `<input type="checkbox" disabled>` elements is the
 * markup this app renders today. The global `index.css:290-303` already dresses those inputs, and
 * the transcript export path depends on them being plain inputs, so nothing here hides one or
 * draws its own.
 *
 * The bar is the shared `Meter` in its stacked register — label, figure, track — because a labelled
 * bar is a component this library already has and a second hand-rolled one is the spelling the
 * plan forbids by name.
 */
export function TaskProgress({ done, total, collapseKey, children }: TaskProgressProps) {
  const { t } = useTranslation('chat');
  // `total` cannot be 0 on the path that reaches here — `ShapeList` returns the plain list for an
  // empty one — but the division is guarded anyway, because a null percent is a state `Meter`
  // already draws honestly (an em-dash and no fill) and a NaN width is one nobody can see coming.
  const percent = total > 0 ? Math.round((done / total) * 100) : null;

  return (
    <ShapeFrame kind="tasks" title={t('shapes.titles.tasks')} collapseKey={collapseKey}>
      <div data-task-progress className="mb-2">
        <Meter
          variant="stacked"
          label={t('shapes.tasksDone', { done, total })}
          value={percent === null ? '' : `${percent}%`}
          percent={percent}
        />
      </div>
      {/* The DISC is dropped and the checkbox is left alone, because on a bulleted task list the
          checkbox IS the marker: `• ☑ read the plan` spends two marks saying one thing.
          A NUMBERED task list keeps its numbers. `1. [x] step one` is written with numbers because
          the reader refers to them — "step 2" — and a number is content a checkbox cannot stand
          in for, so only the `ul` is touched here.
          `>` and not a descendant selector on purpose: a nested sub-list keeps its own bullets —
          `PlainList` re-states `list-disc` on every level, so the inheritance stops at this one.
          Nothing about the list's own markup changes, and every input remark-gfm emitted is
          untouched. */}
      <div className="[&>ul]:list-none [&>ul]:pl-0">{children}</div>
    </ShapeFrame>
  );
}
