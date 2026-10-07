import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { StatusPill } from '@/modules/cerberus/StatusMarks';
import { hms } from '@/modules/cerberus/utils/cerberusTime';
import type { CerberusResultRow } from '@/shared/cerberus-types';
import { Button } from '@/shared/ui';

/**
 * How many rows show before "Show N more". It matches the prototype's twelve, which is enough for a
 * check that changed a few times in three hours. A check that flapped can carry a hundred rows, and
 * the strip and the lookup answer for those without a scroll through all of them.
 */
const FIRST_ROWS = 12;

/**
 * THE CHANGE ROWS, newest first: each stored result a check changed to, with the time it was
 * recorded, its status pill and the value it reported. A row with no stored status is a "not
 * enabled" one. The rows are the read's `recent`: the changes in the 3 h before the strip's end.
 * They arrive newest first, and this piece keeps them that way whatever order it is handed.
 *
 * On a narrow sheet the value wraps under the pill and stays clear of the time column, so the times
 * stay one clean column to scan.
 *
 * `emptyText` is the line drawn when the 3 h hold no change. It defaults to the sheet's "No change
 * recorded in the last 3 h.", which is true of a window ending now. History's window ends at the moment
 * it looks up, so History passes a line that names that moment.
 *
 * Used by the sheet (`CheckSheet`) under "Recorded results · last 3 h", and by History under its
 * lookup.
 */
export function RecordedResults({ rows, emptyText }: { rows: CerberusResultRow[]; emptyText?: string }) {
  const { t } = useTranslation();

  // Whether the reader asked for every row. Essential: only the newest twelve show until asked,
  // and no prop knows that the reader asked.
  const [showingAll, setShowingAll] = useState(false);

  const newestFirst = useMemo(() => [...rows].sort((a, b) => b.at - a.at), [rows]);

  if (newestFirst.length === 0) {
    return <p className="border-t border-border py-2 text-[13px] text-muted-foreground">{emptyText ?? t('cerberus.sheet.noChanges')}</p>;
  }

  const shown = showingAll ? newestFirst : newestFirst.slice(0, FIRST_ROWS);
  const hiddenCount = newestFirst.length - shown.length;

  return (
    <div className="flex flex-col">
      <ol className="flex flex-col">
        {shown.map((row, index) => (
          <li key={`${row.at}:${index}`} className="flex items-baseline gap-3 border-t border-border py-[7px] text-[13px]">
            <time dateTime={new Date(row.at).toISOString()} className="w-16 flex-none tabular-nums text-muted-foreground">
              {hms(row.at)}
            </time>
            <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="w-44 max-w-full flex-none">
                <StatusPill status={row.status ?? 'not_enabled'} />
              </span>
              {row.value !== null && (
                <span className="min-w-0 flex-[1_1_10rem] text-muted-foreground [overflow-wrap:anywhere]">{row.value}</span>
              )}
            </div>
          </li>
        ))}
      </ol>
      {hiddenCount > 0 && (
        <div className="border-t border-border pt-2">
          <Button variant="ghost" size="sm" onClick={() => setShowingAll(true)}>
            {t('cerberus.sheet.moreResults', { count: hiddenCount })}
          </Button>
        </div>
      )}
    </div>
  );
}
