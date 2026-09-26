import type { HealCard, HealClass, HealKindRow, HealStatus } from '@/modules/heal/healTypes';
import type { Tone } from '@/shared/types';

/**
 * How the ledger's facts reach the eye — the same job `dispatcher/dispatcherState.ts` does for a plan.
 *
 * Colour is language here, not decoration: red is a shape a heal claimed coming back, or a review
 * that blocks, amber is a heal that needs a hand or a cap being approached, green is a heal that
 * landed and stayed quiet, grey is what is waiting on purpose or ignored by design. Nothing below
 * spells a colour; tone travels as `tone=` and reaches the paint through the token blocks.
 */

/** The class's own word, for a chip. The door's word (`kind`) is printed as-is and never mapped. */
export function classWord(klass: HealClass): string {
  switch (klass) {
    case 'one-off': return 'one-off';
    case 'recurring': return 'recurring';
    case 'definition-clarity': return 'definition clarity';
    case 'design-flaw': return 'design flaw';
  }
}

/** A recurring cause is the one worth red; a one-off is nothing to act on; the other two are work. */
export function classTone(klass: HealClass): Tone {
  if (klass === 'recurring') return 'danger';
  if (klass === 'one-off') return 'neutral';
  return 'warn';
}

/** Running is in motion, done landed, blocked needs a hand. */
export function statusTone(status: HealStatus): Tone {
  if (status === 'running') return 'info';
  if (status === 'done') return 'positive';
  if (status === 'blocked') return 'warn';
  return 'neutral';
}

export function statusWord(status: HealStatus): string {
  return status.toUpperCase();
}

/** `2h ago`, `3d ago`, `just now` — a still word, for a scaffold that ticks nothing. */
export function agoWord(epochSeconds: number, now = Date.now() / 1000): string {
  const s = Math.max(0, now - epochSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** A future epoch in the reader's own clock — `10:00 AM` — the way a queued run card prints its window. */
export function clockWord(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** `$0.83`. Two places always: a cost that reads `$1` beside one that reads `$0.83` looks like a different unit. */
export function usd(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

/** The last path segment — `abc123.jsonl` — with the line the item is read at: `abc123.jsonl:412`. */
export function transcriptRef(transcript: string, line: number | null): string {
  const cut = transcript.lastIndexOf('/');
  const name = cut === -1 ? transcript : transcript.slice(cut + 1);
  return line === null ? name : `${name}:${line}`;
}

/** The trend glyph and its word. Null trend prints a dash and SAYS "no trend" — never a fabricated arrow. */
export function trendMark(trend: HealKindRow['trend']): { glyph: string; word: string; tone: Tone } {
  if (trend === 'up') return { glyph: '↑', word: 'rising', tone: 'warn' };
  if (trend === 'down') return { glyph: '↓', word: 'falling', tone: 'positive' };
  if (trend === 'flat') return { glyph: '→', word: 'steady', tone: 'neutral' };
  return { glyph: '—', word: 'no trend', tone: 'neutral' };
}

/**
 * Triage order: a regression first (a SHAPE a heal claimed came BACK), then the most live rows, then
 * the all-ignored kinds last — they are by-design refusals and read grey for a reason.
 */
export function byUrgency(a: HealKindRow, b: HealKindRow): number {
  const ra = a.regression ? 1 : 0;
  const rb = b.regression ? 1 : 0;
  if (ra !== rb) return rb - ra;
  if (a.live !== b.live) return b.live - a.live;
  return b.ignored - a.ignored;
}

/** Newest first, a running heal before everything: the card in motion is the one being watched. */
export function byMotionThenNewest(a: HealCard, b: HealCard): number {
  const ma = a.status === 'running' ? 1 : 0;
  const mb = b.status === 'running' ? 1 : 0;
  if (ma !== mb) return mb - ma;
  return b.started_at - a.started_at;
}

/** Athena's verdict as one tone: any blocking is red, any high is amber, a clean review is green. */
export function athenaTone(counts: HealCard['athena']): Tone {
  if (counts === null) return 'neutral';
  if (counts.blocking > 0) return 'danger';
  if (counts.high > 0) return 'warn';
  return 'positive';
}
