import { useTranslation } from 'react-i18next';
import { ArrowRightIcon } from 'lucide-react';

import { Card } from '@/shared/ui';
import type { TableData } from '@/modules/chat/transcript/shapes/detect';
import { ShapeFrame } from '@/modules/chat/transcript/shapes/ShapeFrame';

type BeforeAfterProps = {
  /** Headers exactly `Before | After`, or three headers whose last two are those. */
  data: TableData;
  collapseKey: string;
};

/**
 * A Before/After table as one pair of cards per row.
 *
 * Used by `elements/table.tsx` and nothing else. Like `DecisionMatrix` it is reached only when
 * `hasInlineFormatting` is FALSE of the table, so drawing from `data`'s cell TEXT loses nothing:
 * a pair whose cells carry marks declines at the branch and stays a table.
 *
 * The optional leading column is the pair's HEADING rather than a third card — with three headers
 * the first column names what changed, and a reader scanning a list of changes wants that name on
 * its own line above the two states, not competing with them for width.
 */
export function BeforeAfter({ data, collapseKey }: BeforeAfterProps) {
  const { t } = useTranslation('chat');
  // Two or three headers reach here (`classifyTable`), and `before`/`after` are always the last
  // two — so a third header is the label column and it is always the first.
  const labelColumn = data.headers.length === 3 ? 0 : null;
  const beforeColumn = data.headers.length - 2;
  const afterColumn = data.headers.length - 1;

  return (
    <ShapeFrame kind="before-after" title={t('shapes.titles.beforeAfter')} collapseKey={collapseKey}>
      <div className="flex flex-col gap-3">
        {data.rows.map((row, index) => (
          <div key={index}>
            {labelColumn === null ? null : (
              // The label column's HEADER is drawn beside its value, not just the value. It is the
              // one word here the author chose and nothing can guess — `Risk`, `Endpoint`,
              // `Metric` — and a bare `low` heading leaves the reader asking "low what?". Dropping
              // it would also be this feature's central law broken on a trigger HIT: a shape may
              // never render less than the markdown it replaced.
              <div className="mb-1.5 flex flex-wrap items-baseline gap-1.5">
                <span
                  data-shape-label
                  className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {data.headers[labelColumn]}
                </span>
                <span className="text-sm font-semibold text-foreground">{row[labelColumn]}</span>
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-2">
              <Card className="p-3">
                <div
                  data-shape-label
                  className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
                >
                  {data.headers[beforeColumn]}
                </div>
                <div className="mt-0.5 text-sm text-muted-foreground">{row[beforeColumn]}</div>
              </Card>
              <Card className="p-3">
                {/* The arrow is the second channel: the pair reads left-to-right on a wide screen
                    and top-to-bottom on a phone, where only the arrow still says which way it ran. */}
                <div
                  data-shape-label
                  className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wide text-accent-ink"
                >
                  <ArrowRightIcon aria-hidden="true" className="h-3 w-3 flex-none" />
                  {data.headers[afterColumn]}
                </div>
                <div className="mt-0.5 text-sm text-foreground">{row[afterColumn]}</div>
              </Card>
            </div>
          </div>
        ))}
      </div>
    </ShapeFrame>
  );
}
