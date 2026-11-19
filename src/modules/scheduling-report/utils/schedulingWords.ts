import type { TFunction } from 'i18next';
import { BotIcon, CircleCheckIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

import type { SchedulingAct, SchedulingChosen, SchedulingEntry, SchedulingJob, SchedulingOpener, SchedulingReason, SchedulingSurface } from '@/shared/scheduling-report-types';
import type { AffectedAreasTrouble, Tone } from '@/shared/types';
import { firstLine } from '@/shared/utils';

/*
 * THE SCHEDULING VIEW'S WORDS: how an entry's facts are said. Pure: each function takes `t` and data and returns words (and,
 * for a verdict or an answer, its tone and icon). Every sentence is a `cerberus.scheduling.*` key; a login, a customer, a
 * person's name, a visit type, a code and a reason's detail are DATA and pass through as they arrived (MAN-7868). Ages
 * reuse `cerberus.time.*`, the tab's own, so "2 h ago" reads the same on every view.
 *
 * ONE WORD FOR ONE THING. On screen an entry is a "session" and a hiccup is a "speed bump", in the head, the pills, the
 * rows and the sheet alike; `entry` and `hiccup` are the wire's words and stay in the code.
 */

const K = 'cerberus.scheduling';

/** A verdict or an answer as it is drawn: its tone, its word and its icon, so the colour never stands alone. */
type ToneLook = { tone: Tone; word: string; Icon: LucideIcon };

/**
 * The verdict's word, tone and icon. A MACHINE's entry wears the neutral mark whatever its verdict: it is counted in no
 * figure of the view, so it is never drawn clean or bumped, and the eye cannot count it with people's sessions. A speed
 * bump takes its worst reason's tone, and the two tones take two icons, so they differ without colour.
 */
export function verdictLook(t: TFunction, entry: Pick<SchedulingEntry, 'verdict' | 'tone' | 'actor_kind'>): ToneLook {
  if (entry.actor_kind === 'machine') return { tone: 'neutral', word: t(`${K}.verdict.machine`), Icon: BotIcon };
  if (entry.verdict === 'clean') return { tone: 'positive', word: t(`${K}.verdict.clean`), Icon: CircleCheckIcon };
  return entry.tone === 'danger'
    ? { tone: 'danger', word: t(`${K}.verdict.bump`), Icon: OctagonAlertIcon }
    : { tone: 'warn', word: t(`${K}.verdict.bump`), Icon: TriangleAlertIcon };
}

/**
 * The sheet's heading for an entry, one whole sentence ("This session hit a speed bump"). It has no accent part: the Sheet
 * paints an accent in the accent green whatever it says, and green is this view's word for clean, so the tone is left to
 * the verdict's badge under the heading. A direct entry is a "change", since no form was open to call a session.
 */
export function verdictHeading(t: TFunction, entry: Pick<SchedulingEntry, 'verdict' | 'actor_kind' | 'form'>): string {
  if (entry.actor_kind === 'machine') return t(`${K}.sheet.heading.machine`);
  return t(`${K}.sheet.heading.${entry.form ? 'form' : 'direct'}.${entry.verdict}`);
}

/** Who pressed, as a name to read: the login without its surface prefix (`eis:`), or "nobody on record". */
export function whoWord(t: TFunction, stamp: string | null | undefined): string {
  if (!stamp) return t(`${K}.who.unknown`);
  return stamp.slice(stamp.indexOf(':') + 1) || stamp;
}

/** The job as one line: the customer and the project number, whichever of the two the job list holds, or that it names none. */
export function jobWord(t: TFunction, job: SchedulingJob | null): string {
  if (job?.customer_name && job.project_number) return `${job.customer_name} · ${job.project_number}`;
  return job?.customer_name ?? job?.project_number ?? t(`${K}.job.none`);
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

/** "30 m", "2 h 30 m", "10 h": a visit's length from its whole minutes; a length is never worded in seconds. */
export function lengthWord(t: TFunction, minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 0 && m > 0) return t(`${K}.duration.hm`, { h, m });
  if (h > 0) return t(`${K}.duration.h`, { h });
  return t(`${K}.duration.m`, { m });
}

/** "11:11 AM", in the reader's own clock; `seconds` adds them, for a press, where two can fall in one minute. */
export function clockWord(iso: string, seconds = false): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: seconds ? '2-digit' : undefined });
}

/** "Oct 7, 11:11 AM", in the reader's own clock. */
export function dayClockWord(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** A visit's window as one phrase: "Oct 7, 9:00 AM to 11:00 AM", or its start alone, or that none was set. */
export function spanWord(t: TFunction, start: string | null, end: string | null): string {
  if (start === null) return t(`${K}.span.none`);
  return end === null ? dayClockWord(start) : t(`${K}.span.fromTo`, { from: dayClockWord(start), to: clockWord(end) });
}

/**
 * How an entry ended, in a word or two: Booked, Changed, Cancelled, or what "nothing" was. Nothing done is four different
 * facts and never one phrase: a form still open has not ended; a booking form closed is "Closed without booking"; a form
 * opened on a visit and closed is "Closed without a change" (opening a visit is how one is looked at, so it is no failed
 * booking); and a direct change that was refused or failed "Did not go through", since no form was open to close. A
 * direct Undo that worked is "Undone": the server counts an Undo as no result of its own, and it is not a failure.
 *
 * A result an Undo took back says so in the same words the sheet uses, short ("Booked, then undone"): the row and the
 * sheet must give one answer to "how did it end", and a row that said Booked over a cancelled visit gave another.
 */
export function resultWord(t: TFunction, entry: EndingFacts): string {
  return t(`${K}.result.${endingKey(entry)}`);
}

/** What an entry's ending is read from. */
type EndingFacts = Pick<SchedulingEntry, 'result' | 'state' | 'form' | 'kind' | 'surface' | 'presses' | 'reasons'>;

/**
 * Whether what the entry did was taken back by an Undo right after: the server's `undone` reason, on an entry that
 * booked or changed a visit. The server still calls such an entry `booked` (an Undo is no result of its own), so the
 * view reads the reason wherever it says or counts how a session ended. Used by the words below and by
 * `SchedulingView`'s tally.
 *
 * WHAT THE REASON MEASURES IS NARROWER THAN THAT (`verdict.py`): "an act of this entry is an Undo, or the next act on
 * its visit was one". So three readings are kept apart here. A CANCELLED entry is never undone: nothing un-cancels a
 * visit, and the reason reaches a cancel only when someone else's Undo lands next on the visit, which stays cancelled.
 * An Undo's OWN entry (`isUndoPress`) carries the reason too, and did nothing to be undone. And an Undo that FAILED
 * still sets the reason: an overview entry holds no acts, so that one cannot be told from an Undo that took, and it
 * reads "then undone" over a visit that stands until the wire says whether the Undo ended ok.
 */
export function wasUndone(entry: Pick<SchedulingEntry, 'result' | 'reasons'>): boolean {
  return (entry.result === 'booked' || entry.result === 'changed') && entry.reasons.some((reason) => reason.code === 'undone');
}

/** Whether the entry IS an Undo press: one change made with no form, on the Undo surface (the grid's Undo). The server gives it the `undone` reason as well, where the reason names what the press was, not what became of it. */
export function isUndoPress(entry: Pick<SchedulingEntry, 'form' | 'surface'>): boolean {
  return !entry.form && entry.surface === 'undo';
}

/** Which of the ending's words an entry takes: its result (and that it was undone), or which "nothing" it was. One key for the row's word and the sheet's sentence. */
function endingKey(entry: EndingFacts): string {
  if (entry.result !== 'nothing') return wasUndone(entry) ? `${entry.result}Undone` : entry.result;
  if (isUndoPress(entry)) return entry.presses.ok > 0 ? 'undid' : 'notDone';
  if (!entry.form) return 'notDone';
  if (entry.state === 'open') return 'nothingYet';
  return entry.kind === 'book' ? 'closedWithoutBooking' : 'closedWithoutChange';
}

/**
 * The sheet's one sentence of what happened, the result said whole. A result that was undone says so in the same breath
 * ("A visit was booked, then undone."), so the head never reads as a booking that stands.
 */
export function endingSentence(t: TFunction, entry: EndingFacts): string {
  return t(`${K}.sheet.ending.${endingKey(entry)}`);
}

/** Where a press came from: "In the form", "Dragged on the grid", "Resized on the grid", "Undo", "Through the API". An unknown one is drawn as data. */
export function surfaceWord(t: TFunction, surface: SchedulingSurface): string {
  return t(`${K}.surface.${surface}`, { defaultValue: surface });
}

/** The door the form was opened from, as Restorly's reader knows it; a door this build has no words for is drawn as its own word. */
export function openerWord(t: TFunction, opener: SchedulingOpener): string {
  return t(`${K}.openers.${opener}`, { defaultValue: opener });
}

/**
 * One reason as words: `chip` for an entry's row (a few words, its count inside when it has more than one) and `sentence`
 * for the sheet (its count or its detail said whole). Each code of the closed vocabulary has its keys; a code this build
 * has no words for is drawn as the code itself, as data, and never dropped. A detail is data: the answer's own code, or
 * the calendar's own reason.
 *
 * `undone` is worded as what the server saw, an Undo pressed, and never as what became of the visit: that claim is the
 * result word's, where `wasUndone` decides it. `ownUndo` says the entry is itself the Undo press (`isUndoPress`), whose
 * sentence is that the press was an Undo: "pressed right after" would say the Undo was undone.
 */
export function reasonWords(t: TFunction, reason: SchedulingReason, ownUndo = false): { chip: string; sentence: string } {
  const base = `${K}.reasons.${reason.code}`;
  const detail = firstLine(reason.detail ?? '');
  const values = { count: reason.count ?? 1, detail };
  const plain = t(`${base}.${reason.code === 'undone' && ownUndo ? 'sentenceOwn' : 'sentence'}`, { ...values, defaultValue: reason.code });
  return {
    chip: t(`${base}.chip`, { ...values, defaultValue: reason.code }),
    sentence: detail === '' ? plain : t(`${base}.detail`, { ...values, defaultValue: `${plain} ${detail}` }),
  };
}

/** A reason's icon by its tone: three shapes, so how bad it is reads without colour. */
export const REASON_ICON: Record<SchedulingReason['tone'], LucideIcon> = { danger: OctagonAlertIcon, warn: TriangleAlertIcon, neutral: InfoIcon };

/** What was pressed and from where, as one phrase: "Pressed Save to book", "Dragged the visit on the grid", "Asked to cancel, through the API". */
export function pressedWord(t: TFunction, act: Pick<SchedulingAct, 'kind' | 'surface'>): string {
  const p = `${K}.acts.pressed`;
  return t([`${p}.${act.surface}.${act.kind}`, `${p}.${act.surface}.any`], { defaultValue: `${act.surface} · ${act.kind}` });
}

/**
 * A press's answer in words, with its tone and icon: done; refused and why; unavailable; a server fault. The why is the
 * refusal the code names, in a sentence where this build knows the code and as the code itself, as data, where it does
 * not. The HTTP status is drawn beside it by the caller, as the number it is.
 */
export function answerLook(t: TFunction, act: Pick<SchedulingAct, 'outcome' | 'code' | 'status'>): ToneLook {
  const a = `${K}.acts.answer`;
  switch (act.outcome) {
    case 'ok': return { tone: 'positive', Icon: CircleCheckIcon, word: t(`${a}.ok`) };
    case 'refused': {
      const why = act.code === 'crew_not_confirmed_for_job_type' ? t(`${a}.why.crew`) : act.status === 403 ? t(`${a}.why.login`) : act.code;
      return { tone: 'warn', Icon: TriangleAlertIcon, word: why === null ? t(`${a}.refused`) : t(`${a}.refusedWhy`, { why }) };
    }
    case 'not_found': return { tone: 'warn', Icon: TriangleAlertIcon, word: t(`${a}.refusedWhy`, { why: t(`${a}.why.notFound`) }) };
    case 'invalid': return { tone: 'warn', Icon: TriangleAlertIcon, word: act.code === null ? t(`${a}.refused`) : t(`${a}.refusedWhy`, { why: act.code }) };
    case 'unavailable': return { tone: 'danger', Icon: OctagonAlertIcon, word: act.code === null ? t(`${a}.unavailable`) : t(`${a}.unavailableWhy`, { why: act.code }) };
    case 'fault': return { tone: 'danger', Icon: OctagonAlertIcon, word: t(`${a}.fault`) };
    default: return { tone: 'neutral', Icon: InfoIcon, word: String(act.outcome) };
  }
}

/** The calendar's word on a press's answer, with its tone: paused, confirmed, or failed and why. Null when the answer said nothing of the calendar. */
export function calendarLook(t: TFunction, act: Pick<SchedulingAct, 'calendar' | 'calendar_reason'>): { tone: Tone; word: string } | null {
  const c = `${K}.acts.calendar`;
  if (act.calendar === 'paused') return { tone: 'neutral', word: t(`${c}.paused`) };
  if (act.calendar === 'confirmed') return { tone: 'positive', word: t(`${c}.confirmed`) };
  if (act.calendar === 'error') return { tone: 'danger', word: act.calendar_reason ? t(`${c}.failedWhy`, { why: firstLine(act.calendar_reason) }) : t(`${c}.failed`) };
  return null;
}

/** Where the chosen lead stood on the list Restorly offered: "the best fit", "3rd on the list", "not on the list", or that no lead was chosen. */
export function leadPlace(t: TFunction, chosen: Pick<SchedulingChosen, 'lead_id' | 'lead_rank'>): string {
  const p = `${K}.sheet.chosen.place`;
  if (chosen.lead_id === null) return t(`${p}.none`);
  if (chosen.lead_rank === null) return t(`${p}.offList`);
  return chosen.lead_rank === 0 ? t(`${p}.best`) : t(`${p}.nth`, { count: chosen.lead_rank + 1, ordinal: true });
}

/**
 * The sentence for a read the lane could not answer: CloudCLI has no secret to ask with, Restorly's server did not answer,
 * answered what CloudCLI cannot read, refused, or has no such record. `subject` names what was being read, so a missing
 * entry says the session is not on file and a missing route says the server may be part way through an update.
 */
export function troubleSentence(t: TFunction, trouble: AffectedAreasTrouble, subject: 'overview' | 'entry'): string {
  return t(`${K}.trouble.cause.${trouble}`, { context: subject });
}
