import { FilterXIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { RunRow } from '@/modules/upload-runs/RunRow';
import type { RunFriction, UploadsFilters } from '@/modules/upload-runs/utils/uploadsModel';
import { whoWord } from '@/modules/upload-runs/utils/uploadsWords';
import type { UploadRunSummary, UploadRunsOverview } from '@/shared/upload-runs-types';
import { Banner, Button, Chip, EmptyState } from '@/shared/ui';

type RunListProps = {
  /** The window as the server answered it: the people who pressed, the accounts that have runs, whether it was cut short. */
  overview: UploadRunsOverview;
  /** The runs the list draws, newest first: the window's, less the clean ones while Hiccups only is on. The body counts them for the section's badge, so the badge and the rows are one number. */
  runs: UploadRunSummary[];
  /** What the list is narrowed to. */
  filters: UploadsFilters;
  /** The heal answer per Claude session; null while it is out, or when it could not be read. */
  friction: Map<string, RunFriction> | null;
  /** The heal answer could not be read: said once above the rows, which then carry no friction mark. */
  frictionFailed: boolean;
  now: number;
  onFilter: (filters: UploadsFilters) => void;
  onOpenRun: (sessionId: string) => void;
  /** Try again, when the heal ledger could not be read: re-reads what failed. */
  onRetry: () => void;
};

/** How many rows are drawn before the reader asks for more. A window can hold two thousand runs; the newest are the ones looked for. */
const PAGE = 25;
const NO_FILTERS: UploadsFilters = { by: null, tests: false, hiccupsOnly: false, account: null };

/**
 * RUNS: every run of the window, newest first, under the chips that narrow it.
 *
 * THE CHIPS, in three groups: who (Everyone and one chip per person who pressed, with how many runs each), which
 * (Hiccups only and Test runs, off until asked for, since a dry run is not an upload), and whose (a set of account chips,
 * only once the window holds runs of two accounts: with one account there is nothing to choose). The groups are set
 * apart by space alone and each wraps as one, so a narrow column never starts a line with a stray divider. Each chip is a
 * toggle that says whether it is on (`aria-pressed`); the people and the accounts are data, so nobody's name is written here.
 *
 * THE STATES. A filter that matches nothing says so, with the press that clears it right there. A window with more runs
 * than one answer carries says the list is the newest of them. A heal ledger that could not be read says so once above the
 * rows, with Try again beside it: the rows then show no friction mark, which must not read as "no friction". Only the
 * newest 25 rows are drawn until Show more is pressed, so a ninety-day window opens as fast as a week.
 *
 * Hiccups only is the browser's own filter over the answer in hand, applied by the body before the runs reach this
 * list; the people, Test runs and the accounts are asked of the server, through `onFilter`.
 *
 * Used by this module's `UploadsBody`, as the right column.
 */
export function RunList({ overview, runs, filters, friction, frictionFailed, now, onFilter, onOpenRun, onRetry }: RunListProps) {
  const { t } = useTranslation();
  const r = 'cerberus.uploads.runs';
  // How many rows are on screen: the list's own place, moved only by Show more, so it is held here and not at the root.
  const [limit, setLimit] = useState(PAGE);

  const shown = runs.slice(0, limit);
  const rest = runs.length - shown.length;
  const set = (change: Partial<UploadsFilters>) => onFilter({ ...filters, ...change });

  return (
    <div className="flex min-w-0 flex-col gap-3" data-uploads-runs>
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-1.5" role="group" aria-label={t(`${r}.filters`)}>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip size="sm" className="finger:min-h-11" selected={filters.by === null} onClick={() => set({ by: null })}>{t(`${r}.everyone`)}</Chip>
          {overview.people.map((person) => (
            <Chip key={person.generated_by} size="sm" className="finger:min-h-11" selected={filters.by === person.generated_by} onClick={() => set({ by: person.generated_by })} title={person.generated_by}>
              {whoWord(t, person.generated_by)} <span className="tabular-nums text-muted-foreground">{person.runs}</span>
            </Chip>
          ))}
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          <Chip size="sm" className="finger:min-h-11" selected={filters.hiccupsOnly} onClick={() => set({ hiccupsOnly: !filters.hiccupsOnly })}>{t(`${r}.hiccupsOnly`)}</Chip>
          <Chip size="sm" className="finger:min-h-11" selected={filters.tests} onClick={() => set({ tests: !filters.tests })} title={t(`${r}.testsTitle`)}>{t(`${r}.tests`)}</Chip>
        </div>
        {overview.accounts.length >= 2 && (
          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <Chip size="sm" className="finger:min-h-11" selected={filters.account === null} onClick={() => set({ account: null })}>{t(`${r}.allAccounts`)}</Chip>
            {overview.accounts.map((account) => (
              <Chip key={account} size="sm" className="finger:min-h-11" selected={filters.account === account} onClick={() => set({ account })} title={account}>
                <span className="font-mono">{t(`${r}.account`, { id: account.slice(0, 8) })}</span>
              </Chip>
            ))}
          </div>
        )}
      </div>

      {frictionFailed && (
        // The ledger was not read: the rows below carry no friction mark, and this line is why, with the way to read it again.
        <Banner
          tone="warn"
          action={<Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>{t('cerberus.uploads.trouble.retry')}</Button>}
        >
          <p className="text-xs">{t(`${r}.frictionUnread`)}</p>
        </Banner>
      )}
      {overview.truncated && <p className="text-xs text-muted-foreground">{t(`${r}.truncated`, { count: overview.runs.length })}</p>}

      {runs.length === 0 ? (
        // The filters match nothing: the chips stay above, and the way back is the action.
        <EmptyState size="sm" icon={FilterXIcon} title={t(`${r}.noMatch`)} actionLabel={t(`${r}.clear`)} onAction={() => onFilter(NO_FILTERS)} />
      ) : (
        <>
          <ul className="flex min-w-0 flex-col divide-y divide-border overflow-hidden rounded-lg border border-border">
            {shown.map((run) => (
              <RunRow key={run.session_id} run={run} friction={run.claude_session_id === null ? undefined : friction?.get(run.claude_session_id)} now={now} onOpenRun={onOpenRun} />
            ))}
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
