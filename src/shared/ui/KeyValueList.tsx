import type { ReactNode } from 'react';

import { cn } from '@/shared/utils';

type KeyValueListProps = {
  /** The rows, in order: a label (a noun, said in capitals) and its value, a word, a number or an element; an empty value is an em dash. */
  items: ReadonlyArray<readonly [string, ReactNode]>;
  className?: string;
};

/**
 * THE DESIGN SYSTEM'S KEY-VALUE LIST: label and value rows on the telemetry grid, a 78 px label column in the muted ink and the
 * values in the rest, each one line, cut with an ellipsis. It is words and numbers, so it lives in what a click opened, never on a
 * screen by default.
 *
 * Used by the kanban module's board Opening (`BugBoardOpening`), for the board's counts.
 */
export function KeyValueList({ items, className }: KeyValueListProps) {
  return (
    <dl className={cn('ast-kv', className)}>
      {items.map(([label, value]) => (
        <div key={label} className="contents">
          <dt>{label}</dt>
          <dd title={typeof value === 'string' ? value : undefined}>{value === null || value === undefined || value === '' ? '—' : value}</dd>
        </div>
      ))}
    </dl>
  );
}
