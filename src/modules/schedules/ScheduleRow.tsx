import { DRIFT_BADGE, STATE_BADGE } from '@/modules/schedules/scheduleReadings';
import type { CronJob } from '@/shared/types';
import { Badge } from '@/shared/ui';
import { cn, formatRelativeTime } from '@/shared/utils';

/**
 * The three right-hand cells, shared with SchedulesPanel's column header so the header and every
 * row line up on the same widths. Below `lg` there is no header and the cells run on as one
 * wrapped line of facts under the name; from `lg` up they are columns.
 *
 * Schedule and Where are SHARES of the panel, capped, not fixed widths: the panel's width is the
 * window's minus whatever the sidebar takes, and a fixed Where column starved Name to ~150px in a
 * 760px panel while its own 288px sat mostly empty. A share gives the space back as the panel narrows.
 */
export const SCHEDULE_CELL = 'lg:w-1/5 lg:max-w-52 lg:flex-none';
export const LAST_RUN_CELL = 'lg:w-24 lg:flex-none lg:text-right';
export const WHERE_CELL = 'min-w-0 lg:w-1/4 lg:max-w-80 lg:flex-none';

type ScheduleRowProps = {
  job: CronJob;
};

/**
 * One tracked job, as SchedulesPanel lists it: the plain name, its badges and tags, the purpose beneath,
 * then Schedule, Last run and Where.
 *
 * EVERY FIELD HAS A SLOT. On the face, at every width: name, state, drift, tags, purpose, schedule and
 * its raw expression, last run and its result, the log, and a cron line's run-as user and source.
 * `driftDetail` and `note` get lines of their own the moment they are set, because they are the
 * reason this registry exists rather than a live scan. The command and the row's own timestamps
 * ride the name's `title`: a slot for them at phone width would be a per-row disclosure, and
 * Refresh is this screen's one control.
 *
 * A row is read-only and never a control: there is nothing here to click, so nothing pretends to be.
 */
export function ScheduleRow({ job }: ScheduleRowProps) {
  const state = STATE_BADGE[job.state];
  const drift = job.drift === 'none' ? null : DRIFT_BADGE[job.drift];
  // A cron line with no `>>` writes to the journal. A prompt has no log: it is sent into a chat
  // session, and that — not the table that stores it — is where its outcome is read.
  // The owner's home reads as `~`, so a truncated path keeps the file name in view longer.
  const home = `/home/${job.owner}/`;
  const log = job.logPath?.startsWith(home) ? `~/${job.logPath.slice(home.length)}` : job.logPath;
  const where = log ?? (job.kind === 'cron' ? 'journal' : 'chat session');

  return (
    <li className="flex flex-col gap-1 border-b border-border px-3.5 py-2.5 lg:flex-row lg:items-start lg:gap-3">
      <div className="min-w-0 lg:flex-1">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className="min-w-0 truncate text-[13.5px] font-medium"
            title={`${job.command}\n\nTracked ${formatRelativeTime(job.trackedAt)} · last touched ${formatRelativeTime(job.updatedAt)}`}
          >
            {job.name}
          </span>
          <Badge as="span" tone={state.tone} className="vv-badge--compact shrink-0">{state.label}</Badge>
          {drift && <Badge as="span" tone={drift.tone} className="vv-badge--compact shrink-0">{drift.label}</Badge>}
          {job.kind === 'scheduled-prompt' && (
            <Badge as="span" tone="neutral" variant="outline" className="vv-badge--compact shrink-0">Prompt</Badge>
          )}
          {/* What the job is FOR, in a word each — read at a glance down the column. Grey and filled,
              never a tone: colour on this row already means state, and a green `cleanup` beside a
              green OK would read as a second verdict. Filled rather than outlined so a tag is never
              mistaken for the Prompt kind marker beside it. */}
          {job.tags.map((tag) => (
            <Badge key={tag} as="span" tone="neutral" className="vv-badge--compact shrink-0 lowercase">{tag}</Badge>
          ))}
        </div>
        {/* A null purpose is said, faintly, rather than left blank: "nobody has written down why
            this runs" is itself the fact an adopted job arrives with. */}
        <p className={cn('truncate text-[12.5px]', job.purpose ? 'text-muted-foreground' : 'italic text-ink-faint')}>
          {job.purpose ?? 'No purpose recorded'}
        </p>
        {/* The detail speaks in its badge's tone: amber and marked only when the drift is a warning.
            An adopted job's detail is news, not a problem. */}
        {job.driftDetail && drift?.tone === 'warn' && <p className="text-[12.5px] text-warn-ink">▲ {job.driftDetail}</p>}
        {job.driftDetail && drift?.tone !== 'warn' && <p className="text-[12.5px] text-muted-foreground">{job.driftDetail}</p>}
        {job.note && <p className="text-[12.5px] text-muted-foreground">Note — {job.note}</p>}
      </div>

      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[12.5px] text-muted-foreground lg:contents">
        <span className={SCHEDULE_CELL} title={job.nextRunAt ?? undefined}>
          {job.scheduleText}
          {job.expression && <span className="ml-1.5 font-mono text-[11.5px] text-ink-faint lg:ml-0 lg:block">{job.expression}</span>}
        </span>
        <span className={LAST_RUN_CELL} title={job.lastRunAt ?? 'Never seen running'}>
          <span className="lg:hidden">Last run </span>
          {formatRelativeTime(job.lastRunAt)}
          {job.lastResult && <span className="ml-1.5 text-[11.5px] text-ink-faint lg:ml-0 lg:block">{job.lastResult}</span>}
        </span>
        <span className={cn(WHERE_CELL, 'block max-w-full truncate font-mono text-[12px]')} title={`${job.logPath ?? where}\n${job.owner} · ${job.source}`}>
          {where}
          {/* Run-as user and the file the line lives in. A prompt has neither to show: its owner is a
              user id and its source is the table that stores it, both kept on this cell's title. */}
          {job.kind === 'cron' && (
            <span className="block truncate font-sans text-[11.5px] text-ink-faint">
              {job.owner} · {job.source}
            </span>
          )}
        </span>
      </div>
    </li>
  );
}
