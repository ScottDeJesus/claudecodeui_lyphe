import type { Tone } from '@/shared/types';

/**
 * The formatters every part of the Jev view shares, so a dollar reads the same in the balance, the
 * table and the feed. Each is a pure function of its number; `—` is the one word for "not known".
 */

/** `$0.050` under a dollar (a third decimal, because most asks cost tenths of a cent), `$1.00` from one up, `—` when unpriced. */
export function usd(n: number | null): string {
  if (n === null || !Number.isFinite(n)) return '—';
  return n < 1 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`;
}

/** `2.0M` / `1.5k`, and the bare number under a thousand. */
export function tokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** A share in 0..1 as a whole percent: `50%`. */
export function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/** How long ago an epoch-seconds stamp was, in the shortest unit that is not zero: `12s` / `4m` / `2h` / `3d`. */
export function ago(ts: number, now: number = Date.now() / 1000): string {
  const s = Math.max(0, Math.floor(now - ts));
  if (s < 60) return `${s}s`;
  if (s < 3_600) return `${Math.floor(s / 60)}m`;
  if (s < 86_400) return `${Math.floor(s / 3_600)}h`;
  return `${Math.floor(s / 86_400)}d`;
}

/** A latency: `0.30s`, or `—` when the row carried none. */
export function seconds(n: number | null): string {
  return n === null || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}s`;
}

/** A character delta with its sign always shown: `+12,300` / `−4,500` (a true minus, not a hyphen). */
export function signedChars(n: number): string {
  const abs = Math.abs(n).toLocaleString('en-US');
  return n < 0 ? `−${abs}` : `+${abs}`;
}

/** A plain count with thousands separators: `2,000`. */
export function count(n: number): string {
  return n.toLocaleString('en-US');
}

/**
 * The glyph tokens.css pairs with each tone (`--tone-glyph`), for a badge or a mark that has to
 * survive greyscale: the badge paints the tone but prints no glyph of its own, so the part writes it.
 */
export function toneGlyph(tone: Tone): string {
  return { neutral: '·', info: 'i', positive: '✓', warn: '▲', danger: '✕' }[tone];
}
