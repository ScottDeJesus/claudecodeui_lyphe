import type { TFunction } from 'i18next';

import type { RndCandidate, RndPicture, RndSchedule, RndWord, RndScoutOut } from '@/shared/rnd-types';
import { formatRelativeTime } from '@/shared/utils';

/** The place's four views. Verdicts holds two words: what a spike proved, then what was adopted from it. */
export type RndView = 'waiting' | 'spiking' | 'verdicts' | 'rejected';

export const RND_VIEWS: readonly RndView[] = ['waiting', 'spiking', 'verdicts', 'rejected'];

/** The open candidate's plate, in px. */
export const OPENING_WIDTH_PX = 440;
/** The room the plate needs past a row's end to stand beside the list: its width, its distance from the mark and the edge's air. */
export const OPENING_BESIDE_PX = OPENING_WIDTH_PX + 64;

const VIEW_WORDS: Record<RndView, readonly RndWord[]> = {
  waiting: ['waiting'],
  spiking: ['spiking'],
  verdicts: ['proved', 'adopted'],
  rejected: ['rejected'],
};

/**
 * A WORD'S TONE. The place is quiet by default: waiting, adopted and rejected are neutral, a spike that is out is info, and the
 * one green is a yes that waits for his Adopt. Nothing here is red: a rejection is a decision, not a fault.
 */
export const WORD_TONE: Record<RndWord, 'info' | 'positive' | 'neutral'> = {
  waiting: 'neutral',
  spiking: 'info',
  proved: 'positive',
  adopted: 'neutral',
  rejected: 'neutral',
};

/** The host a page is on, as a reader says it: no scheme, no www. An address that is not one is said as it stands. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** A view's rows, in the picture's own order (newest first), a view of two words holding the first word's rows first. */
export function rowsOf(picture: RndPicture, view: RndView): RndCandidate[] {
  return VIEW_WORDS[view].flatMap((word) => picture.candidates.filter((candidate) => candidate.word === word));
}

/** The word a row and its Opening wear: proved while Opus places it reads Placing, in the spiking tone; else its own. */
export function statusOf(candidate: RndCandidate): { word: RndWord | 'placing'; tone: 'info' | 'positive' | 'neutral' } {
  if (candidate.word === 'proved' && candidate.placing?.state === 'out') return { word: 'placing', tone: 'info' };
  return { word: candidate.word, tone: WORD_TONE[candidate.word] };
}

/**
 * The number a view wears, from the picture's own standing: how many stand at its first word. On Verdicts that is the proved
 * alone, the yeses waiting for his Adopt; the adopted are done, and are counted on their own rule under them.
 */
export function countOf(picture: RndPicture, view: RndView): number {
  return picture.standing[VIEW_WORDS[view][0]];
}

/** The header's lines about the scout: what its run is doing or last did, each source's scout, and when it next goes out by itself. */
export type ScoutLine = {
  /** A run is out now: the line wears the loop and Scout now waits. */
  out: boolean;
  line: string;
  /** The last run's outcome when it ended without an answer, as one word for a badge; null otherwise. */
  trouble: string | null;
  /** The run's source scouts and its ranker, each with its state (an ended one with its outcome); null before a run of them. */
  scouts: string | null;
  /** When it next goes out by itself, or that it goes out only when pressed. */
  schedule: string;
};

/**
 * THE SCOUT'S LINE, the first that holds: a run is out (how many of its sources are read); there is nothing for one to read;
 * none has gone out; the last one ended without an answer; the last one filed something; the last one found nothing new.
 * Beside it, the run's source scouts and its ranker. scheduleWords says the schedule as a day and a time.
 */
export function scoutLine(picture: RndPicture, t: TFunction, scheduleWords: (schedule: RndSchedule) => string): ScoutLine {
  const { out, last } = picture.scout;
  const setting = picture.settings.schedule;
  const schedule = setting.frequency === 'off'
    ? t('rnd.scout.noSchedule')
    : t('rnd.scout.scheduled', { when: scheduleWords(setting) });
  const run = out ?? last;
  const scouts = run === null || run.scouts.length === 0 ? null : runWords(run, t);
  if (out !== null) {
    const read = out.scouts.filter((one) => one.state === 'ended').length;
    const line = t('rnd.scout.outRun', { ago: formatRelativeTime(out.started_at), read, total: out.scouts.length });
    return { out: true, line, trouble: null, scouts, schedule };
  }
  if (picture.settings.sources.length === 0) return { out: false, line: t('rnd.scout.noSources'), trouble: null, scouts, schedule };
  if (last === null) return { out: false, line: t('rnd.scout.never'), trouble: null, scouts, schedule };
  const ago = formatRelativeTime(last.ended_at ?? last.started_at);
  if (last.outcome === 'failed' || last.outcome === 'lost') {
    return { out: false, line: t('rnd.scout.lastTrouble', { ago }), trouble: t('rnd.scout.outcome.' + last.outcome), scouts, schedule };
  }
  const line = last.filed > 0 ? t('rnd.scout.lastFiled', { ago, filed: last.filed }) : t('rnd.scout.lastNothing', { ago });
  return { out: false, line, trouble: null, scouts, schedule };
}

/** Each source scout of a run with its state (an ended one with its outcome), then its ranker's, as one line. */
function runWords(run: RndScoutOut, t: TFunction): string {
  const sources = run.scouts.map((one) => t('rnd.scout.source', { source: hostOf(one.source), word: t('rnd.scout.state.' + (one.outcome ?? one.state)) }));
  const ranker = t('rnd.scout.ranker', { word: t('rnd.scout.state.' + (run.ranker.outcome ?? run.ranker.state)) });
  return [...sources, ranker].join(' · ');
}
