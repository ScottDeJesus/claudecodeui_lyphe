import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { WebWalkAutocorrect, WebWalkAutocorrected, WebWalkUncorrected } from '@/shared/analytics-types';
import type { DataTableColumn } from '@/shared/types';
import { Button, DataTable, FoldChevron, Readout, Rule } from '@/shared/ui';
import { rankedCorrected, rankedRefused } from '@/modules/analytics/sections/web-walk/webWalkFigures';

/** The refusals shown before the rest fold away: the ones most walks met are the ones to read. */
const MOST_SHOWN = 8;

type WebWalkAutocorrectionProps = {
  /** What Autocorrect rewrote, by its table's entry, and the step refusals walks still met. */
  autocorrect: WebWalkAutocorrect;
  /** Every walk of the window: what the refused walks are a part of. */
  walks: number;
  /** The window, for the tables' names and the quiet lines. */
  days: number;
};

/**
 * AUTOCORRECT: what the helper made of the steps written wrongly. Two figures, each over its own list. First, how many
 * steps it corrected, then by which entry of its table, the one that corrected most first: an entry is named by the
 * table's own label, its code name small under it. Second, how many walks were still refused over a step's wording, of
 * all the walks, then each refusal, the one most walks met first; one the helper means says so under its wording.
 *
 * A REFUSAL IS CUT AT TWO LINES and carries its whole wording in its title; a pressed refusal opens under itself to the
 * whole wording and the next step: where an entry for it would be written, or, for one refused on purpose, the helper's
 * own reason and that the step is the thing to change. One is open at a time, none on arrival. Past MOST_SHOWN refusals the rest fold away behind one
 * button, closed on every mount.
 *
 * A window with neither says so in one line; a window with only one of the two says so where that list would stand.
 *
 * Rendered by WebWalkSection, last. Nothing else mounts it.
 */
export function WebWalkAutocorrection({ autocorrect, walks, days }: WebWalkAutocorrectionProps) {
  const { t } = useTranslation('common');
  const headingId = useId();
  const refusedId = useId();
  const corrected = rankedCorrected(autocorrect.corrected);
  const refused = rankedRefused(autocorrect.refused);
  // None open on arrival.
  const [expanded, setExpanded] = useState<string | null>(null);
  const [allShown, setAllShown] = useState(false);
  const onExpand = (key: string | null) => setExpanded(key);
  const onToggleAll = () => setAllShown((shown) => !shown);

  const unknown = t('analytics.webWalk.unknown');
  const steps = corrected.reduce((sum, row) => sum + row.steps, 0);
  const refusedWalks = refused.reduce((sum, row) => sum + row.walks, 0);
  const shown = allShown ? refused : refused.slice(0, MOST_SHOWN);

  const correctedColumns: DataTableColumn<WebWalkAutocorrected>[] = [
    {
      key: 'mistake',
      label: t('analytics.webWalk.autocorrect.corrected.columns.mistake'),
      render: (row) => (
        <span className="flex flex-col gap-0.5">
          <span>{row.label}</span>
          {row.entry !== row.label && <span className="text-xs font-normal text-muted-foreground [overflow-wrap:anywhere]">{row.entry}</span>}
        </span>
      ),
    },
    { key: 'steps', label: t('analytics.webWalk.autocorrect.corrected.columns.steps'), align: 'end', render: (row) => <span className="tabular-nums">{row.steps.toLocaleString()}</span> },
  ];

  const refusedColumns: DataTableColumn<WebWalkUncorrected>[] = [
    {
      key: 'refusal',
      label: t('analytics.webWalk.autocorrect.refused.columns.refusal'),
      render: (row) => (
        <span className="flex flex-col justify-center gap-0.5 font-normal finger:min-h-11">
          <span className="line-clamp-2 [overflow-wrap:anywhere]" title={row.whole} data-web-walk-refusal>{row.whole}</span>
          {row.on_purpose && <span className="text-xs text-muted-foreground">{t('analytics.webWalk.autocorrect.refused.onPurpose')}</span>}
        </span>
      ),
    },
    { key: 'walks', label: t('analytics.webWalk.autocorrect.refused.columns.walks'), align: 'end', render: (row) => <span className="tabular-nums">{row.walks.toLocaleString()}</span> },
  ];

  const whole = (row: WebWalkUncorrected) => (
    <div className="flex flex-col gap-2">
      <p className="text-sm [overflow-wrap:anywhere]">{row.whole}</p>
      <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]">
        {row.on_purpose ? t('analytics.webWalk.autocorrect.refused.nextOnPurpose', { reason: row.reason ?? row.on_purpose }) : t('analytics.webWalk.autocorrect.refused.next')}
      </p>
    </div>
  );

  return (
    <section className="flex min-w-0 flex-col gap-3" aria-labelledby={headingId} data-web-walk-autocorrect>
      <Rule id={headingId}>{t('analytics.webWalk.autocorrect.title')}</Rule>
      {corrected.length === 0 && refused.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('analytics.webWalk.autocorrect.quiet', { days })}</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">{t('analytics.webWalk.autocorrect.about')}</p>
          <div className="grid min-w-0 grid-cols-1 items-start gap-9 pt-1 xl:grid-cols-2 xl:gap-8">
            <div className="flex min-w-0 flex-col gap-3" data-web-walk-autocorrect-corrected>
              <Readout
                label={t('analytics.webWalk.autocorrect.corrected.figure')}
                value={steps}
                note={corrected.length === 0 ? t('analytics.webWalk.autocorrect.corrected.noteNone', { days }) : t('analytics.webWalk.autocorrect.corrected.note', { count: corrected.length, days })}
                unknownLabel={unknown}
              />
              {corrected.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('analytics.webWalk.autocorrect.corrected.quiet')}</p>
              ) : (
                <DataTable rows={corrected} columns={correctedColumns} rowKey={(row) => row.entry} label={t('analytics.webWalk.autocorrect.corrected.tableLabel', { days })} />
              )}
            </div>
            <div className="flex min-w-0 flex-col gap-3" data-web-walk-autocorrect-refused>
              <Readout
                label={t('analytics.webWalk.autocorrect.refused.figure')}
                value={refusedWalks}
                note={refused.length === 0 ? t('analytics.webWalk.autocorrect.refused.noteNone', { walks: walks.toLocaleString() }) : t('analytics.webWalk.autocorrect.refused.note', { count: refused.length, walks: walks.toLocaleString() })}
                unknownLabel={unknown}
              />
              {refused.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('analytics.webWalk.autocorrect.refused.quiet')}</p>
              ) : (
                <>
                  <div id={refusedId}>
                    <DataTable rows={shown} columns={refusedColumns} rowKey={(row) => row.whole} label={t('analytics.webWalk.autocorrect.refused.tableLabel', { days })} expanded={expanded} onExpand={onExpand} renderExpanded={whole} />
                  </div>
                  {refused.length > MOST_SHOWN && (
                    <Button variant="ghost" size="sm" className="-ml-3 self-start text-muted-foreground finger:h-11" aria-expanded={allShown} aria-controls={refusedId} onClick={onToggleAll}>
                      <FoldChevron collapsed={!allShown} />
                      {allShown ? t('analytics.webWalk.autocorrect.refused.showFewer', { count: MOST_SHOWN }) : t('analytics.webWalk.autocorrect.refused.showAll', { count: refused.length })}
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
