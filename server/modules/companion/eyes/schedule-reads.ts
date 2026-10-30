import { readRegistry } from '@/modules/schedules/index.js';
import { textResult, type ToolTextResult } from '@/shared/tool-text-result.js';
import type { CronJob, CronJobDrift, CronJobState, CronSyncReport } from '@/shared/types.js';

import type { CompanionToolDeps } from '../tools/companion-tools.js';

import { LIST_ABOUT_NOTHING } from './card-shapes.js';
import { answerRead, whenWords } from './eyes-answer.js';
import { clipLine, counted, fitLines } from './line-words.js';

/**
 * `read_schedules`: the schedules, read through the Schedules tab's own reader (`readRegistry`: the registry's cron rows and the
 * signed-in account's pending scheduled prompts). `scope` is:
 *   - `list`: every job, one line each: `<name> · <schedule in words> · <state> · last <when>`, a prompt's with ` · next <when>`;
 *   - `drift`: the jobs whose drift is not none, each with its clause;
 *   - a job's name: its purpose, command, log, last run and drift; one job holding a phrase in its name, purpose, command or tags
 *     is answered the same way, several as lines.
 * The heading says when the registry was last synced, because a registry is only as true as its last sync. Nothing here writes a
 * job. With `panel: true` the whole answer goes on his panel. A command is masked of anything that looks like a credential
 * (`clipLine`).
 *
 * Consumed by `panel-reads.ts`, which builds the tool.
 */

/** The state words the Schedules tab's badges print, in lower case. */
const STATE_WORDS: Readonly<Record<CronJobState, string>> = {
  ok: 'ok',
  failed: 'failed',
  missing: 'missing',
  unknown: 'unchecked',
  pending: 'pending',
  sent: 'sent',
  cancelled: 'cancelled',
};

/** What each drift means, as the tab's badges say it. `none` is never said. */
const DRIFT_WORDS: Readonly<Record<Exclude<CronJobDrift, 'none'>, string>> = {
  adopted: 'newly adopted',
  missing: 'gone from the box',
  changed: 'changed',
};

/** The longest name and command a line carries. */
const NAME_MAX = 60;
const COMMAND_MAX = 300;

/** What a dactyl is asked of a list or a job that came out past 2,000 characters (`NO_SPEND` is added by `wholeOrDigest`). */
const LIST_BRIEF = 'List the jobs, one line each, keeping each name, its state and what is wrong with it. At most 15 lines; cite L<n>.';
const JOB_BRIEF = 'What does this job do, when does it run, and is anything wrong with it? At most 8 lines; cite L<n>.';

/** The drift word of a job, or `null` for a job that agrees with the box. */
const driftWord = (job: CronJob): string | null => (job.drift === 'none' ? null : DRIFT_WORDS[job.drift]);

/** One job as one line: `<name> · <schedule> · <state> · last <when>`, and ` · next <when>` for a prompt. */
function jobLine(job: CronJob): string {
  const last = job.lastRunAt === null ? 'last run not seen' : `last ${whenWords(job.lastRunAt)}`;
  const next = job.kind === 'scheduled-prompt' && job.nextRunAt !== null ? ` · next ${whenWords(job.nextRunAt)}` : '';
  return `${clipLine(job.name, NAME_MAX)} · ${job.scheduleText} · ${STATE_WORDS[job.state]} · ${last}${next}`;
}

/** Where a job's output goes: its log, else the journal (a cron line) or the chat (a prompt). The owner's home reads as `~`. */
function whereWords(job: CronJob): string {
  if (job.logPath === null) return job.kind === 'cron' ? 'the journal' : 'a chat session';
  const home = `/home/${job.owner}/`;
  return job.logPath.startsWith(home) ? `~/${job.logPath.slice(home.length)}` : job.logPath;
}

/** One job in full: its purpose, command, log, last run and drift. */
function jobDetail(job: CronJob): string {
  const drift = driftWord(job);
  return [
    `${clipLine(job.name, NAME_MAX)} · ${job.scheduleText} · ${STATE_WORDS[job.state]}`,
    `Purpose: ${job.purpose ?? 'none recorded'}`,
    `Command: ${clipLine(job.command, COMMAND_MAX)}`,
    `Output: ${whereWords(job)}`,
    `Last run: ${job.lastRunAt === null ? 'not seen' : `${whenWords(job.lastRunAt)}${job.lastResult === null ? '' : ` (${job.lastResult})`}`}`,
    ...(job.kind === 'scheduled-prompt' && job.nextRunAt !== null ? [`Next: ${whenWords(job.nextRunAt)}`] : []),
    `Drift: ${drift === null ? 'none' : `${drift}${job.driftDetail === null ? '' : ` — ${clipLine(job.driftDetail, COMMAND_MAX)}`}`}`,
  ].join('\n');
}

/** When the registry was last synced, in the heading's words. */
function syncWords(lastSync: CronSyncReport | null): string {
  if (lastSync === null) return 'The registry has never synced.';
  return `The registry last synced ${whenWords(lastSync.ranAt)}${lastSync.ok ? '' : ' and that sync failed'}.`;
}

/** Whether a job's name, purpose, command or tags hold the lower-cased phrase. */
const holds = (job: CronJob, lower: string): boolean =>
  [job.name, job.purpose ?? '', job.command, ...job.tags].some((field) => field.toLowerCase().includes(lower));

/** `read_schedules`: see the file's head. */
export function readSchedules(
  deps: CompanionToolDeps,
  args: { scope: string; panel?: boolean },
  signal: AbortSignal | undefined
): Promise<ToolTextResult> | ToolTextResult {
  const panel = args.panel === true;
  const scope = args.scope.trim();
  const lower = scope.toLowerCase();
  const { jobs, lastSync } = readRegistry(deps.userId);
  const sync = syncWords(lastSync);
  const answer = (title: string, text: string, intro: string, brief: string): Promise<ToolTextResult> | ToolTextResult =>
    answerRead(deps, { panel, title, text, label: 'schedules', brief, intro, shape: LIST_ABOUT_NOTHING }, signal);

  if (lower === 'list') {
    if (jobs.length === 0) return textResult(`No job is tracked. ${sync}`);
    return answer('Schedules', fitLines(jobs.map(jobLine)), `${counted(jobs.length, 'tracked job')}. ${sync}`, LIST_BRIEF);
  }
  if (lower === 'drift') {
    const drifting = jobs.filter((job) => job.drift !== 'none');
    if (drifting.length === 0) return textResult(`No schedule is drifting: every tracked job agrees with the box. ${sync}`);
    const lines = drifting.map((job) => `${clipLine(job.name, NAME_MAX)} · ${driftWord(job)}${job.driftDetail === null ? '' : ` · ${clipLine(job.driftDetail, COMMAND_MAX)}`}`);
    return answer('Schedules drifting', fitLines(lines), `${counted(drifting.length, 'job')} drifting. ${sync}`, LIST_BRIEF);
  }

  const exact = jobs.filter((job) => job.name.toLowerCase() === lower);
  const fits = exact.length > 0 ? exact : jobs.filter((job) => holds(job, lower));
  if (fits.length === 0) return textResult(`No tracked job has "${scope}" in its name, purpose, command or tags. read_schedules list shows them all.`);
  if (fits.length === 1) return answer(fits[0].name, jobDetail(fits[0]), sync, JOB_BRIEF);
  return answer(`Schedules: ${scope}`, fitLines(fits.map(jobLine)), `${counted(fits.length, 'job')} fit "${scope}". ${sync}`, LIST_BRIEF);
}
