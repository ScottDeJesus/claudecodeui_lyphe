import { createHash } from 'node:crypto';

import {
  cronJobsDb,
  scheduledMessagesDb,
  type ScheduledMessageRow,
  type ScheduledMessageStatus,
} from '@/modules/database/index.js';
import type { CronJob, CronJobState, CronRegistrySnapshot } from '@/shared/types.js';

/**
 * The registry, read: the whole of what `GET /api/schedules` answers with.
 *
 * Two sources, and the difference between them is the reason this is a function rather than one
 * query. The cron half is the registry's own table, which the sync writes and this only reads.
 * The scheduled-prompt half is not in that table at all: a prompt lives in `scheduled_messages`,
 * where the app's dispatcher owns it, and it is read LIVE on every request instead of being copied
 * into the registry, so the screen shows the operator's own pending questions as they stand rather
 * than as they stood at the last sync. A prompt that fires is therefore never a stale row here —
 * it stops being pending, and the next read says so.
 *
 * That live read is why this takes a `userId`, and the parameter is not ceremony:
 * `scheduledMessagesDb`'s readers are user-scoped and there is no `listAll` on it, because one
 * person's scheduled prompts are not another's to see. The route hands over the id the guard
 * authenticated, which is the whole of what transport knows that this cannot work out for itself.
 *
 * Nothing here shells anything and nothing here opens a file. A row is served exactly as the store
 * holds it, and that is deliberate rather than unfinished: a `crontab -l` on the read path to
 * confirm a line still exists would be the live derivation the sync exists to replace, and it
 * would put a subprocess on every tab open. The sync is the only thing that looks at the box.
 *
 * An empty registry is not a failure. No sync has run yet and nobody has scheduled anything is the
 * honest reading of a fresh install, and it leaves as an empty `jobs` with `lastSync: null`.
 */

/** How much of a prompt's text a row carries as its command — the whole of it is the message. */
const COMMAND_LIMIT = 120;

/** How much of that a row's name carries. A name is a handle, not a summary. */
const NAME_LIMIT = 60;

/** The fallback for a prompt whose text is entirely whitespace: it still needs a handle. */
const UNNAMED_PROMPT = 'Scheduled prompt';

/** Plain words for a one-shot instant, in this box's own zone — the phrase the screen shows. */
const SCHEDULE_TEXT_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
});

/**
 * A stored timestamp as ISO-8601, which is the shape the contract declares for it.
 *
 * SQLite's own `CURRENT_TIMESTAMP` default writes `YYYY-MM-DD HH:MM:SS` in UTC, and `new Date()`
 * reads that spelling as LOCAL time — an instant shifted by the box's offset, silently, on the two
 * columns a row's age is shown from. So the UTC mark is restored before parsing. A `scheduled_for`
 * arrives already ISO (the client sends an absolute instant) and passes through unchanged, and
 * anything at all that will not parse is handed back as the store wrote it rather than replaced
 * with a plausible instant that was never recorded.
 */
function isoInstant(value: string): string {
  const utcSpelling = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}Z`
    : value;
  const parsed = new Date(utcSpelling);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
}

/** The same instant as ISO-8601, or `null` when the column will not parse into one. */
function isoInstantOrNull(value: string): string | null {
  const iso = isoInstant(value);
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

/** A prompt's moment as plain words, falling back to the raw column when it will not parse. */
function scheduleText(scheduledFor: string): string {
  const iso = isoInstantOrNull(scheduledFor);
  return iso === null ? scheduledFor : SCHEDULE_TEXT_FORMAT.format(new Date(iso));
}

/** The text of a row as its command, cut to what the screen can hold and marked when it was cut. */
function commandText(content: string): string {
  const cut = content.slice(0, COMMAND_LIMIT);
  return cut === content ? cut : `${cut}…`;
}

/** A row's plain name, taken off the command's first line — what the row is called on sight. */
function nameText(command: string): string {
  const firstLine = command.split('\n')[0].trim();
  if (!firstLine) return UNNAMED_PROMPT;
  return firstLine.length > NAME_LIMIT ? `${firstLine.slice(0, NAME_LIMIT)}…` : firstLine;
}

/**
 * The row's id, derived the way the contract declares every registry id: kind, origin, and the
 * first twelve hex digits of the command's SHA-1.
 */
function jobId(kind: CronJob['kind'], origin: CronJob['origin'], command: string): string {
  const digest = createHash('sha1').update(command).digest('hex').slice(0, 12);
  return `${kind}:${origin}:${digest}`;
}

/**
 * A pending prompt's status as a registry state, ONE-TO-ONE and with nothing collapsed.
 *
 * The mapping is written out rather than defaulted because the two unions are not the same set: a
 * scheduled prompt may be `pending`, which is not a cron value at all, and `pending` is the
 * operator's own open question — the row exists precisely because nobody has answered it yet. A
 * `?? 'unknown'` here would read as "the registry does not know" and quietly throw that away.
 */
function promptState(status: ScheduledMessageStatus): CronJobState {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'sent':
      return 'sent';
    case 'failed':
      return 'failed';
    case 'cancelled':
      return 'cancelled';
  }
}

/**
 * One `scheduled_messages` row as a registry job.
 *
 * The fields the contract declares and no reader can fill — `purpose`, `note`, the log path, the
 * last run and its result — are `null`: a scheduled prompt has no `>>` redirection and no journal
 * line, and a reader that invented one would be inventing a fact. `drift` is `'none'` because
 * there is nothing to drift FROM: the row is read live from the store that owns it, so this is not
 * a record of the prompt, it is the prompt.
 */
function toPromptJob(message: ScheduledMessageRow, userId: number): CronJob {
  const command = commandText(message.content);

  return {
    id: jobId('scheduled-prompt', 'user', command),
    kind: 'scheduled-prompt',
    name: nameText(command),
    purpose: null,
    tags: [],
    owner: String(userId),
    origin: 'user',
    expression: '',
    scheduleText: scheduleText(message.scheduled_for),
    command,
    logPath: null,
    state: promptState(message.status),
    drift: 'none',
    driftDetail: null,
    lastRunAt: null,
    lastResult: null,
    nextRunAt: isoInstantOrNull(message.scheduled_for),
    note: null,
    source: 'scheduled_messages',
    trackedAt: isoInstant(message.created_at),
    updatedAt: isoInstant(message.updated_at),
  };
}

/**
 * Every tracked job, and the last sync that touched them: the registry's own rows first — ordered
 * by the table, the order they entered it — then the asking user's pending prompts, soonest first.
 */
export function readRegistry(userId: number): CronRegistrySnapshot {
  const prompts = scheduledMessagesDb.listPendingForUser(userId).map((row) => toPromptJob(row, userId));

  return {
    readAt: new Date().toISOString(),
    jobs: [...cronJobsDb.listJobs(), ...prompts],
    lastSync: cronJobsDb.lastSync(),
  };
}
