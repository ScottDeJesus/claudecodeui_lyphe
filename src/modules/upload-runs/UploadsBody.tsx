import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { HowOften } from '@/modules/upload-runs/HowOften';
import { RunList } from '@/modules/upload-runs/RunList';
import { UploadTypeList } from '@/modules/upload-runs/UploadTypeList';
import type { UploadsFilters, UploadsRead } from '@/modules/upload-runs/utils/uploadsModel';
import type { UploadRunsOverview } from '@/shared/upload-runs-types';
import { Badge } from '@/shared/ui';

type UploadsBodyProps = {
  /** The window as the server answered it. */
  overview: UploadRunsOverview;
  /** The whole read: the body draws its joins (friction, regression) and its buckets (days, hours). */
  read: UploadsRead;
  filters: UploadsFilters;
  now: number;
  onFilter: (filters: UploadsFilters) => void;
  onOpenRun: (sessionId: string) => void;
  /** Try again, when the heal ledger could not be read. */
  onRetry: () => void;
};


/**
 * THE BODY: By upload type and How often on the left, Runs on the right.
 *
 * TWO COLUMNS ONCE THE VIEW ITSELF IS 48rem WIDE, never the window: the root is a size container, so a Cerberus tab
 * squeezed by the sidebar stacks instead of clipping its rows (the heal panel's own rule and its own number). The left
 * column is the narrower (2fr to the runs' 3fr): its rows are counts, the runs' rows are sentences. Narrower, everything
 * is one column in the same order, types, how often, runs, which is the order a phone reads them in. The columns flow in
 * the tab's own scroll; nothing here scrolls inside itself.
 *
 * Each section is addressable by id, so a pill can carry the reader to it, and is headed by the tab's eyebrow with a
 * short hint of how to read it.
 *
 * THE RUNS BADGE IS THE LIST'S OWN NUMBER. Hiccups only is applied here, once, and the same runs are counted for the
 * badge and handed to the list, so the badge never says 31 over ten rows. Uploads are counted apart from test runs
 * ("31 + 1 test"), so with Test runs on the badge still agrees with the head, whose figures leave tests out.
 *
 * Used by this module's root, `UploadsView`, under Live now.
 */
export function UploadsBody({ overview, read, filters, now, onFilter, onOpenRun, onRetry }: UploadsBodyProps) {
  const { t } = useTranslation();
  const s = 'cerberus.uploads.sections';
  const listed = filters.hiccupsOnly ? overview.runs.filter((run) => run.verdict === 'hiccup' && !run.dry_run) : overview.runs;
  const tests = listed.filter((run) => run.dry_run).length;
  const uploads = listed.length - tests;
  const badge = listed.length === 0 ? undefined : tests === 0 ? String(uploads) : t(`${s}.runsWithTests`, { uploads, count: tests });

  return (
    // The classes are written whole, one per rule, since Tailwind reads them as text: the 48rem line is the heal panel's.
    <div
      className="flex min-w-0 flex-col gap-7 [@container(min-width:48rem)]:grid [@container(min-width:48rem)]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] [@container(min-width:48rem)]:items-start [@container(min-width:48rem)]:gap-x-8"
      data-uploads-body
    >
      <div className="flex min-w-0 flex-col gap-7" data-uploads-column="left">
        <UploadsSection id="uploads-types" title={t(`${s}.types`)} hint={t(`${s}.typesHint`)}>
          <UploadTypeList types={overview.types} runs={overview.runs} regression={read.regression} friction={read.friction} frictionFailed={read.frictionFailed} now={now} onOpenRun={onOpenRun} />
        </UploadsSection>
        <UploadsSection id="uploads-often" title={t(`${s}.often`)} hint={t(`${s}.oftenHint`)}>
          <HowOften days={read.days} hours={read.hours} />
        </UploadsSection>
      </div>
      <UploadsSection id="uploads-runs" title={t(`${s}.runs`)} hint={t(`${s}.runsHint`)} badge={badge}>
        <RunList overview={overview} runs={listed} filters={filters} friction={read.friction} frictionFailed={read.frictionFailed} now={now} onFilter={onFilter} onOpenRun={onOpenRun} onRetry={onRetry} />
      </UploadsSection>
    </div>
  );
}

/** A titled block of the body, addressable by id so a pill can carry the reader to it. Its hint is set apart by space, with no dot of its own: when it wraps under the title, no stray mark leads its line. */
function UploadsSection({ id, title, hint, badge, children }: { id: string; title: string; hint: string; badge?: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="flex min-w-0 scroll-mt-4 flex-col gap-3" data-uploads-section={id}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 id={`${id}-title`} className="text-xs font-normal uppercase tracking-[0.14em] text-muted-foreground">{title}</h3>
        {badge !== undefined && <Badge as="span" tone="neutral">{badge}</Badge>}
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </section>
  );
}
