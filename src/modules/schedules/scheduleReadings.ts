import type { CronJob, CronJobDrift, CronJobState, CronSyncReport, Tone } from '@/shared/types';
import { formatRelativeTime } from '@/shared/utils';

/**
 * How each fact the registry holds READS on the Schedules screen: the tone and the word for a
 * job's state, for its drift, and for the age of the last sync. Read by SchedulesPanel (the
 * header's freshness, the groups' attention counts) and ScheduleRow (the two badges).
 *
 * AMBER, NEVER RED. A failed or missing job is something to look at, not something destroyed,
 * and the doctrine keeps `danger` for destructive and denied (DESIGN_DOCTRINE §5). The tone is
 * never the whole signal either: every entry is a word the badge prints (§6).
 */
export const STATE_BADGE: Record<CronJobState, { label: string; tone: Tone }> = {
  ok: { label: 'OK', tone: 'positive' },
  failed: { label: 'Failed', tone: 'warn' },
  missing: { label: 'Missing', tone: 'warn' },
  unknown: { label: 'Unchecked', tone: 'neutral' },
  pending: { label: 'Pending', tone: 'info' },
  sent: { label: 'Sent', tone: 'positive' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** `none` has no entry on purpose: a job that agrees with the box carries no second badge. */
export const DRIFT_BADGE: Record<Exclude<CronJobDrift, 'none'>, { label: string; tone: Tone }> = {
  adopted: { label: 'Adopted', tone: 'info' },
  missing: { label: 'Gone from box', tone: 'warn' },
  changed: { label: 'Changed', tone: 'warn' },
};

/**
 * A job the operator should look at: exactly what the screen paints amber — a warn state, or drift
 * that moved the job away from the box (`missing`, `changed`). `adopted` is not one. It is how every
 * line the first sync reads arrives, and only the door clears it — so counting it would flag every
 * line written into the crontab by hand for good and bury the one that really went missing.
 */
export function needsLook(job: CronJob): boolean {
  return STATE_BADGE[job.state].tone === 'warn' || (job.drift !== 'none' && DRIFT_BADGE[job.drift].tone === 'warn');
}

/** Past this age a sync's answer is too old to vouch for the rows it wrote. */
const STALE_AFTER_MS = 60 * 60 * 1000;

/**
 * The header's verdict on the last sync. A stored registry is only as true as its last sync, and
 * the sync's own cron line cannot report a failure it never reached — so an old sync, a failed
 * sync and no sync at all each read as `warn` with a sentence saying so, and only a recent, clean
 * one reads as neutral. `warning` is null exactly when the rows can be taken at their word.
 *
 * `now` is the panel's minute tick rather than a read of the clock, so a tab left open crosses the
 * one-hour line on its own. A `ranAt` that will not parse fails CLOSED, as warn: a sync time nobody
 * can read vouches for nothing.
 */
export function syncFreshness(lastSync: CronSyncReport | null, now: number): { tone: Tone; label: string; warning: string | null } {
  if (lastSync === null) {
    return {
      tone: 'warn',
      label: 'Never synced',
      warning: 'Nothing has ever synced — no cron line on this box has been read into the registry. Refresh runs the first sync.',
    };
  }
  const age = formatRelativeTime(lastSync.ranAt);
  if (!lastSync.ok) {
    return {
      tone: 'warn',
      label: `Sync failed ${age}`,
      warning: `The last sync failed ${age}${lastSync.error ? ` — ${lastSync.error}` : ''}. These rows may be stale.`,
    };
  }
  const ranAt = Date.parse(lastSync.ranAt);
  if (Number.isNaN(ranAt)) {
    return {
      tone: 'warn',
      label: 'Sync time unreadable',
      warning: `The last sync's time (${lastSync.ranAt}) could not be read — these rows may be stale.`,
    };
  }
  if (now - ranAt > STALE_AFTER_MS) {
    return { tone: 'warn', label: `Synced ${age}`, warning: `Last synced ${age} — these rows may be stale.` };
  }
  return { tone: 'neutral', label: `Synced ${age}`, warning: null };
}
