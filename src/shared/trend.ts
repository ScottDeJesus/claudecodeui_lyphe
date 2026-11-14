import type { Tone } from '@/shared/types';

/**
 * The trend glyph and its word. Null trend prints a dash and SAYS "no trend" — never a fabricated arrow.
 *
 * A file of its own in `shared/`, beside `spend.ts`, because a trend has to be worded in ONE place: the heal tab's kind
 * rows and Cerberus's Uploads view (its upload types) must say rising, steady and falling in the same words, or two tabs
 * can disagree about one direction. It reads a rising count as the worse direction (warn) and a falling one as the better
 * (positive), so it is for counts of trouble — friction rows, hiccup runs — and never for counts of successes.
 */
export function trendMark(trend: 'up' | 'down' | 'flat' | null): { glyph: string; word: string; tone: Tone } {
  if (trend === 'up') return { glyph: '↑', word: 'rising', tone: 'warn' };
  if (trend === 'down') return { glyph: '↓', word: 'falling', tone: 'positive' };
  if (trend === 'flat') return { glyph: '→', word: 'steady', tone: 'neutral' };
  return { glyph: '—', word: 'no trend', tone: 'neutral' };
}
