import { Clock, RefreshCw } from 'lucide-react';

import { LAST_RUN_CELL, SCHEDULE_CELL, ScheduleRow, WHERE_CELL } from '@/modules/schedules/ScheduleRow';
import { useMinuteTick } from '@/modules/schedules/hooks/useMinuteTick';
import { useSchedules } from '@/modules/schedules/hooks/useSchedules';
import { needsLook, syncFreshness } from '@/modules/schedules/scheduleReadings';
import type { CronJob } from '@/shared/types';
import { Badge, Banner, Button, EmptyState, ScrollArea, Spinner } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** The one group's heading. The OS's own cron is not read, so every row here is one this house made. */
const GROUP_TITLE = 'Your jobs';

/** Jobs that need a look float to the top of their group; the rest keep a stable order by name. */
function byAttention(a: CronJob, b: CronJob): number {
  return Number(needsLook(b)) - Number(needsLook(a)) || a.name.localeCompare(b.name);
}

/**
 * The Schedules tab: every scheduled job the registry tracks — the operator's crontab and his
 * scheduled prompts — read from the store, never scanned from the box.
 *
 * THE HEADER LEADS WITH THE SYNC'S AGE. A stored registry is only as true as its last sync, and
 * that sync can die silently, so its age is the first fact here and it carries its own tone: a
 * recent clean sync is neutral, and an old, failed or absent one is `warn` WITH a sentence under
 * the header saying the rows may be stale. A dead sync must never look like confident rows.
 *
 * READ-ONLY. Refresh is the one control, and it runs a sync: there is no run-now or pause here,
 * because a control the backend cannot serve is a promise the app breaks.
 */
export function SchedulesPanel() {
  const { snapshot, loading, syncing, error, refresh } = useSchedules();
  // The header's Refresh and the empty state's, as one handler: a sync, then a re-read.
  const onRefresh = refresh;
  // A render clock, not a poll: it fetches nothing; it lets the sync's age cross the one-hour line, and every "ago" advance, while the tab stays open.
  const now = useMinuteTick();

  const jobs = snapshot?.jobs ?? [];
  const lastSync = snapshot?.lastSync ?? null;
  const freshness = snapshot ? syncFreshness(lastSync, now) : null;
  const sorted = [...jobs].sort(byAttention);
  const attention = sorted.filter(needsLook).length;

  return (
    <section aria-label="Schedules" className="flex h-full min-h-0 flex-col">
      <header className="flex flex-none flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b border-border px-4 py-3">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg border border-primary/25 bg-primary/10 text-primary">
          <Clock className="size-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-medium">Schedules</h2>
        {/* The sync's age and its counts travel together. On a phone they take the line under the
            title, so Refresh keeps its place on the first line however long the age reads. */}
        {freshness && (
          <div className="order-last flex basis-full flex-wrap items-center gap-x-2.5 gap-y-1 sm:order-none sm:basis-auto">
            <Badge as="span" tone={freshness.tone} title={lastSync ? `${lastSync.ranAt} · took ${lastSync.ms} ms` : undefined}>
              {freshness.label}
            </Badge>
            {lastSync?.ok && (
              <span className="text-[12.5px] tabular-nums text-muted-foreground">
                {lastSync.seen} lines seen · {lastSync.adopted} adopted · {lastSync.missing} missing · {lastSync.changed} changed
              </span>
            )}
          </div>
        )}
        <Button variant="outline" size="sm" className="ml-auto" disabled={syncing || loading} onClick={onRefresh}>
          <RefreshCw className={cn(syncing && 'animate-spin')} aria-hidden="true" />
          {syncing ? 'Syncing…' : 'Refresh'}
        </Button>
      </header>

      {/* Above the rows and beside them, never instead of them: a failed refresh leaves the last
          good read on screen, and a stale sync is said over the rows it cannot vouch for. */}
      {(error || (freshness?.warning && jobs.length > 0)) && (
        <div className="flex flex-none flex-col gap-2 px-4 py-3">
          {error && (
            <Banner tone="warn">
              {!snapshot && `The registry could not be read — ${error}. Refresh tries again.`}
              {snapshot && `Refresh failed — ${error}.${jobs.length > 0 ? ' The rows below are the last good read.' : ''}`}
            </Banner>
          )}
          {freshness?.warning && jobs.length > 0 && <Banner tone="warn">{freshness.warning}</Banner>}
        </div>
      )}

      {loading && !snapshot && !error && (
        <div className="flex flex-1 items-center justify-center p-4">
          <Spinner size={28} label="Reading the registry…" />
        </div>
      )}

      {/* Shown under a failed refresh too: the registry WAS read and holds nothing, and Refresh is
          still the way to fill it. Only a read that never answered has no empty state to show. */}
      {snapshot && jobs.length === 0 && (
        <div className="flex flex-1 items-center justify-center p-4">
          <EmptyState
            icon={Clock}
            title="Nothing is tracked yet"
            message="Refresh reads this box's crontabs and adopts every job it finds into the registry."
            actionLabel="Refresh"
            onAction={onRefresh}
          />
        </div>
      )}

      {jobs.length > 0 && (
        <ScrollArea className="min-h-0 flex-1">
          <div className="sticky top-0 z-10 hidden items-center gap-3 border-b border-border bg-background px-3.5 py-2 text-xs uppercase tracking-[0.14em] text-ink-faint lg:flex">
            <span className="min-w-0 flex-1">Name</span>
            <span className={SCHEDULE_CELL}>Schedule</span>
            <span className={LAST_RUN_CELL}>Last run</span>
            <span className={WHERE_CELL}>Where</span>
          </div>
          <section aria-label={GROUP_TITLE}>
            <h3 className="flex items-baseline gap-2 border-b border-border bg-muted/60 px-3.5 py-1.5 text-[12px] font-medium text-muted-foreground">
              <span>{GROUP_TITLE}</span>
              <span className="tabular-nums text-ink-faint">{sorted.length}</span>
              {attention > 0 && (
                <span className="text-warn-ink">▲ {attention} {attention === 1 ? 'needs' : 'need'} a look</span>
              )}
            </h3>
            <ul>
              {sorted.map((job) => (
                <ScheduleRow key={job.id} job={job} />
              ))}
            </ul>
          </section>
        </ScrollArea>
      )}
    </section>
  );
}
