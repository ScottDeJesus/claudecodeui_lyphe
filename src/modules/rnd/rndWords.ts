import type { TFunction } from 'i18next';

import type { RndCandidate, RndPicture, RndWord } from '@/shared/rnd-types';
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

/**
 * The number a view wears, from the picture's own standing: how many stand at its first word. On Verdicts that is the proved
 * alone, the yeses waiting for his Adopt; the adopted are done, and are counted on their own rule under them.
 */
export function countOf(picture: RndPicture, view: RndView): number {
  return picture.standing[VIEW_WORDS[view][0]];
}

/** The header's two lines about the scout: what it is doing or last did, and when it next goes out by itself. */
export type ScoutLine = {
  /** One is out now: the line wears the loop and Scout now waits. */
  out: boolean;
  line: string;
  /** The last scout's outcome when it ended without an answer, as one word for a badge; null otherwise. */
  trouble: string | null;
  weekly: string;
};

/**
 * THE SCOUT'S LINE, the first that holds: one is out; there is nothing for one to read; none has gone out; the last one ended
 * without an answer; the last one filed something; the last one found nothing new. weeklyWords says a cron expression as a day
 * and a time.
 */
export function scoutLine(picture: RndPicture, t: TFunction, weeklyWords: (expression: string) => string): ScoutLine {
  const { out, last } = picture.scout;
  const weekly = picture.settings.weekly === null
    ? t('rnd.scout.noWeekly')
    : t('rnd.scout.weekly', { when: weeklyWords(picture.settings.weekly) });
  if (out !== null) return { out: true, line: t('rnd.scout.out', { ago: formatRelativeTime(out.started_at) }), trouble: null, weekly };
  if (picture.settings.sources.length === 0) return { out: false, line: t('rnd.scout.noSources'), trouble: null, weekly };
  if (last === null) return { out: false, line: t('rnd.scout.never'), trouble: null, weekly };
  const ago = formatRelativeTime(last.ended_at ?? last.started_at);
  if (last.outcome === 'failed' || last.outcome === 'lost') {
    return { out: false, line: t('rnd.scout.lastTrouble', { ago }), trouble: t('rnd.scout.outcome.' + last.outcome), weekly };
  }
  const line = last.filed > 0 ? t('rnd.scout.lastFiled', { ago, filed: last.filed }) : t('rnd.scout.lastNothing', { ago });
  return { out: false, line, trouble: null, weekly };
}
