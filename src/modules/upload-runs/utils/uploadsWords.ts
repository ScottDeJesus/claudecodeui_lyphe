import type { TFunction } from 'i18next';
import { CircleCheckIcon, FlaskConicalIcon, HourglassIcon, OctagonAlertIcon, RadioIcon, TriangleAlertIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { TimelineEvent, Tone } from '@/shared/types';
import type { UploadRunEvent, UploadRunReason, UploadRunSummary, UploadType } from '@/shared/upload-runs-types';
import { firstLine } from '@/shared/utils';

/*
 * THE UPLOADS VIEW'S WORDS: how a run's facts are said. Pure: each function takes `t` and data and returns words (and, for
 * a verdict, its tone and icon). Every sentence is a `cerberus.uploads.*` key; a login, a customer, a flow, a step name, a
 * reason's detail and a tool's summary are DATA and pass through as they arrived (MAN-7868). Ages reuse `cerberus.time.*`,
 * the tab's own, so "2 h ago" reads the same on every view.
 */

const K = 'cerberus.uploads';

/** A verdict as it is drawn: its tone, its word and its icon, so the colour never stands alone. */
export type VerdictLook = { tone: Tone; word: string; Icon: LucideIcon };

/** The state the registry gives a live run while it waits on a person's answer. */
const AWAITING = 'awaiting_input';

/**
 * The verdict's word, tone and icon. A run still going is live whatever else it is, and a live run that waits on a person
 * says so in the warn tone wherever it is drawn (its row, its sheet), as the head and Live now do: waiting is the state to
 * notice. A dry run is a TEST run and wears the neutral mark: it is never drawn clean or hiccup, so the eye cannot count
 * it with the uploads that were real. A hiccup takes its worst reason's tone, and the two tones take two icons, so they
 * differ without colour.
 */
export function verdictLook(t: TFunction, run: Pick<UploadRunSummary, 'verdict' | 'tone' | 'dry_run' | 'state'>): VerdictLook {
  if (run.verdict === 'live' && run.state === AWAITING) return { tone: 'warn', word: t(`${K}.verdict.waiting`), Icon: HourglassIcon };
  if (run.verdict === 'live') return { tone: 'info', word: t(`${K}.verdict.live`), Icon: RadioIcon };
  if (run.dry_run) return { tone: 'neutral', word: t(`${K}.verdict.test`), Icon: FlaskConicalIcon };
  if (run.verdict === 'clean') return { tone: 'positive', word: t(`${K}.verdict.clean`), Icon: CircleCheckIcon };
  return run.tone === 'danger'
    ? { tone: 'danger', word: t(`${K}.verdict.hiccup`), Icon: OctagonAlertIcon }
    : { tone: 'warn', word: t(`${K}.verdict.hiccup`), Icon: TriangleAlertIcon };
}

/**
 * The sheet's heading for a run, one whole sentence ("This run hit a hiccup"). It has no accent part: the Sheet paints an
 * accent in the accent green whatever it says, and green is this view's word for clean, so the tone is left to the
 * verdict's badge under the heading.
 */
export function verdictHeading(t: TFunction, run: Pick<UploadRunSummary, 'verdict' | 'dry_run' | 'state'>): string {
  const which = run.verdict === 'live' ? (run.state === AWAITING ? 'waiting' : 'live') : run.dry_run ? 'test' : run.verdict;
  return t(`${K}.sheet.heading.${which}`);
}

/** Who pressed, answered or stopped, as a name to read: the login without its surface prefix (`eis:`), or "nobody on record". */
export function whoWord(t: TFunction, stamp: string | null | undefined): string {
  if (!stamp) return t(`${K}.who.unknown`);
  return stamp.slice(stamp.indexOf(':') + 1) || stamp;
}

/** "Initial upload", "Final upload", or that the launch named none. */
export function typeWord(t: TFunction, type: UploadType | null): string {
  return t(`${K}.type.${type ?? 'none'}`);
}

/** The flow's own name (data), or that none was named. */
export function flowWord(t: TFunction, archetype: string | null): string {
  return archetype ?? t(`${K}.flow.none`);
}

/** The job as one line: the customer and the project number, or the label the launch carried, or that it had none (a test run). */
export function jobWord(t: TFunction, run: Pick<UploadRunSummary, 'customer_name' | 'project_number' | 'job_label'>): string {
  if (run.customer_name && run.project_number) return `${run.customer_name} · ${run.project_number}`;
  return run.customer_name ?? run.project_number ?? run.job_label ?? t(`${K}.job.none`);
}

/** "just now", "12 min ago", "3 d ago": an ISO time's age against `now` (epoch ms), in the tab's own time words. */
export function agoWord(t: TFunction, iso: string, now: number): string {
  const seconds = Math.max(0, Math.floor((now - Date.parse(iso)) / 1000));
  if (seconds < 10) return t('cerberus.time.justNow');
  if (seconds < 60) return t('cerberus.time.secondsAgo', { count: seconds });
  if (seconds < 3600) return t('cerberus.time.minutesAgo', { count: Math.floor(seconds / 60) });
  if (seconds < 86400) return t('cerberus.time.hoursAgo', { count: Math.floor(seconds / 3600) });
  return t('cerberus.time.daysAgo', { count: Math.floor(seconds / 86400) });
}

/** "48 s", "4 m 48 s", "1 h 12 m": a length of time in whole units, the two largest. */
export function durationWord(t: TFunction, ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return t(`${K}.duration.hm`, { h, m });
  if (m > 0) return t(`${K}.duration.ms`, { m, s });
  return t(`${K}.duration.s`, { s });
}

/** How long a run took, in ms: to its ending, or to `now` while it is live. Null when its ending was never recorded. */
export function runLength(run: Pick<UploadRunSummary, 'started_at' | 'ended_at' | 'verdict'>, now: number): number | null {
  if (run.ended_at !== null) return Date.parse(run.ended_at) - Date.parse(run.started_at);
  return run.verdict === 'live' ? now - Date.parse(run.started_at) : null;
}

/** "11:11 AM", in the reader's own clock. */
export function clockWord(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** "Oct 7, 11:11 AM", in the reader's own clock. */
export function dayClockWord(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * One reason as words: `chip` for a run's row (a few words, its count inside) and `sentence` for the sheet (its count or
 * its detail said whole). Each code of the closed vocabulary has its keys; a code this build has no words for is drawn as
 * the code itself, as data, and never dropped. A detail is data: who stopped it, why it never started, the first line of
 * what its process wrote as it died.
 */
export function reasonWords(t: TFunction, reason: UploadRunReason): { chip: string; sentence: string } {
  const base = `${K}.reasons.${reason.code}`;
  const raw = reason.detail ?? '';
  const detail = reason.code === 'stopped_by_person' ? whoWord(t, raw) : firstLine(raw);
  const values = { count: reason.count ?? 1, detail };
  const plain = t(`${base}.sentence`, { ...values, defaultValue: reason.code });
  return {
    chip: t(`${base}.chip`, { ...values, defaultValue: reason.code }),
    sentence: raw === '' ? plain : t(`${base}.detail`, { ...values, defaultValue: `${plain} ${detail}` }),
  };
}

/**
 * The ending sentence: who stopped it, or what its exit said. `ending`, `stop_reason` and `terminal_reason` are three facts
 * and stay three: this reads `ending` (how the registry says it ended), names `stopped_by` when a person pressed Stop, and
 * for a process that died quotes its exit code and the first line of its stderr. An ending it has no sentence for is said
 * as the registry wrote it.
 */
export function endingSentence(
  t: TFunction,
  run: Pick<UploadRunSummary, 'ending' | 'ended_at' | 'verdict' | 'state' | 'stopped_by' | 'rc' | 'stderr_head' | 'terminal_reason'>,
): string {
  const e = `${K}.ending`;
  if (run.verdict === 'live') return t(run.state === AWAITING ? `${e}.waiting` : `${e}.live`);
  const { ending } = run;
  if (ending === null) return t(run.ended_at === null ? `${e}.notRecorded` : `${e}.unnamed`);
  if (ending === 'operator_stop') return run.stopped_by ? t(`${e}.stoppedBy`, { who: whoWord(t, run.stopped_by) }) : t(`${e}.stopped`);
  if (ending === 'watchdog_max_runtime') return t(`${e}.tooLong`);
  if (ending === 'watchdog_idle') return t(`${e}.idle`);
  if (ending.startsWith('watchdog_')) return t(`${e}.automatic`, { ending });
  if (ending === 'service_restart') return t(`${e}.restart`);
  if (ending === 'orphaned_live') return t(`${e}.orphaned`);
  if (ending.startsWith('released:')) return t(`${e}.released`, { why: ending.slice('released:'.length) });
  if (run.rc !== null && run.rc !== 0) {
    const line = firstLine(run.stderr_head);
    return line === '' ? t(`${e}.exited`, { rc: run.rc }) : t(`${e}.exitedSaying`, { rc: run.rc, line });
  }
  if (ending === 'sentinel' || run.terminal_reason === 'completed') return t(`${e}.finished`);
  return t(`${e}.other`, { ending });
}

/** A text field of an event's `meta`, or '' when it holds none: `meta` is the kind's own facts, typed loosely on the wire. */
function metaText(event: UploadRunEvent, key: string): string {
  const value = event.meta?.[key];
  return typeof value === 'string' || typeof value === 'number' ? String(value) : '';
}

/**
 * One event as the line the sheet's feed draws: its tone, who spoke (`source`), the readable line (`title`), a second line
 * (`summary`) and what the row opens to (`meta`). `result` is the tool result that answers a tool call, when the page holds
 * it. A kind this build has no words for is drawn neutral with its kind as data. Everything the agent, a tool or a person
 * wrote is passed through as text, never as markup.
 */
function eventLine(t: TFunction, event: UploadRunEvent, result: UploadRunEvent | undefined): TimelineEvent {
  const e = `${K}.events`;
  const when = new Date(event.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  const text = event.text ?? '';
  const whole = text.includes('\n') || text.length > 140 ? text : undefined;
  const line = (tone: Tone, source: string, title: string, summary?: string, meta?: string): TimelineEvent => ({ tone, source, title, summary, when, meta });
  const server = t(`${e}.source.server`);
  switch (event.kind) {
    case 'session_started': return line('neutral', server, t(`${e}.started`));
    case 'brief': return line('neutral', server, t(`${e}.brief`), t(`${e}.briefHint`), text);
    case 'agent_init': return line('neutral', server, t(`${e}.init`, { model: metaText(event, 'model') || '—' }), t(`${e}.initTools`, { count: Number(metaText(event, 'tool_count')) || 0 }));
    case 'assistant_text': return line('neutral', t(`${e}.source.agent`), firstLine(text) || '—', undefined, whole);
    case 'injected_text': return line('neutral', server, t(`${e}.injected`), firstLine(text), whole);
    case 'operator_text': return line('info', whoWord(t, metaText(event, 'by') || null), t(`${e}.answered`, { text: firstLine(text) }), undefined, whole);
    case 'tool_use': {
      const ok = result?.tool?.ok ?? null;
      const status = result === undefined ? t(`${e}.toolNoResult`) : ok === false ? t(`${e}.toolFailed`) : t(`${e}.toolOk`);
      const said = result?.tool?.summary ?? '';
      return line(ok === false ? 'warn' : 'neutral', event.tool?.name ?? t(`${e}.source.tool`), event.tool?.summary ?? '—', said === '' ? status : `${status} · ${said}`, said || undefined);
    }
    case 'tool_result': return line(event.tool?.ok === false ? 'warn' : 'neutral', t(`${e}.source.tool`), event.tool?.summary ?? '—', event.tool?.ok === false ? t(`${e}.toolFailed`) : t(`${e}.toolOk`));
    case 'rate_limit': {
      const facts = [metaText(event, 'status'), metaText(event, 'rate_limit_type')].filter(Boolean).join(' · ');
      return metaText(event, 'status') === 'allowed' ? line('neutral', server, t(`${e}.rateChecked`), facts) : line('warn', server, t(`${e}.rateLimited`), facts);
    }
    case 'turn_end': return line('neutral', server, t(event.meta?.closing_ask === true ? `${e}.turnEndAsk` : `${e}.turnEnd`), metaText(event, 'terminal_reason'));
    case 'state': {
      const to = metaText(event, 'to');
      return to === 'awaiting_input'
        ? line('warn', server, t(`${e}.asked`), metaText(event, 'reason'))
        : line('neutral', server, t(`${e}.state`, { from: metaText(event, 'from') || '—', to: to || '—' }), metaText(event, 'reason'));
    }
    case 'quiet': return line('warn', server, t(`${e}.quiet`, { seconds: metaText(event, 'seconds') || '—' }));
    case 'stream_error': return line('warn', server, t(`${e}.streamError`), firstLine(text), whole);
    case 'replay_gap': return line('neutral', server, t(`${e}.replayGap`));
    case 'subscriber_dropped': return line('neutral', server, t(`${e}.dropped`));
    case 'session_ended': {
      const stoppedBy = metaText(event, 'stopped_by');
      const facts = [metaText(event, 'reason'), stoppedBy === '' ? '' : whoWord(t, stoppedBy)].filter(Boolean).join(' · ');
      return line(metaText(event, 'rc') === '0' ? 'neutral' : 'warn', server, t(`${e}.ended`), facts);
    }
    default: return line('neutral', event.kind, firstLine(text) || t(`${e}.unknown`), undefined, whole);
  }
}

/** One line of the feed with the id of the event it draws, which is what an open row is remembered by. */
export type EventLine = TimelineEvent & { id: string };

/**
 * A page of events as the feed's lines, in order. A tool's result is folded into its call's line (its status and its own
 * first words), so a call and its answer read as one line; a result whose call is on an earlier page keeps a line of its own.
 * Each line carries its event's id: its `seq`, or for the two synthetic kinds the stream sends at seq 0, its kind and time.
 */
export function eventLines(t: TFunction, events: UploadRunEvent[]): EventLine[] {
  const results = new Map<string, UploadRunEvent>();
  const called = new Set<string>();
  for (const event of events) {
    const id = event.tool?.id;
    if (!id) continue;
    if (event.kind === 'tool_result') results.set(id, event);
    if (event.kind === 'tool_use') called.add(id);
  }
  return events
    .filter((event) => !(event.kind === 'tool_result' && event.tool?.id && called.has(event.tool.id)))
    .map((event) => ({
      ...eventLine(t, event, event.kind === 'tool_use' && event.tool?.id ? results.get(event.tool.id) : undefined),
      id: event.seq > 0 ? String(event.seq) : `${event.kind}@${event.ts}`,
    }));
}
