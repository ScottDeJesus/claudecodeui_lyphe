import type { TFunction } from 'i18next';

import { moneyText } from '@/shared/spend';
import type { ClaudeApiKeyPicture, Tone } from '@/shared/types';

/**
 * THE KEY ROW'S ONE STANDING LINE — the sentence under a slot's name that says where that key
 * stands. It lives beside the row rather than inside it because it is all decision and no layout:
 * given the door's picture for one slot, which clause does the reader need, in which tone.
 *
 * THE ORDER IS THE READER'S. A wall is why the key is not paying, so it comes first; then an open
 * window (the key is spending its credit down before it renews away); then the next window's
 * opening; then the absence of a renewal day, which is the one state with a thing to do about it.
 * The clause this returns is the row's only colour: its tone is carried on `data-tone`, never on a
 * colour utility, and a dot alone never carries a state — the words beside it always say it.
 *
 * Used by `ClaudeApiKeyRow`.
 */

/** A stated day in the reader's own locale — `15 Nov 2026` — from an epoch second or an ISO stamp. */
export function formatDay(value: number | string | null): string {
  if (value === null) return '';
  const date = typeof value === 'number' ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** A stated time in the reader's own locale — `13:30` — from an epoch second. */
function formatClock(value: number | null): string {
  if (value === null) return '';
  return new Date(value * 1000).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * `$31.80`, at the cent always. A cycle total is not a per-launch bill: `moneyText`'s four-decimal
 * branch would draw a fresh key's zero spend as `$0.0000` — a precision artifact in the one figure
 * the reader is meant to trust. The scale is pinned to `1` rather than derived from the amount or
 * the credit, so a spend or credit of `0` stays at two decimals instead of falling into that branch
 * (scale `0` would).
 */
function usd(amount: number): string {
  return `$${moneyText(amount, 1)}`;
}

export type Standing = {
  tone: Tone;
  /** The spend base, or null for a slot holding nothing (or one whose state is unknown). */
  base: string | null;
  /** The one state clause the line always carries. */
  clause: string;
};

/**
 * One slot's standing, chosen by the data. `unknown` is the failed read: it is drawn as unknown in
 * words and never as "not set", because a key the card cannot see is not a key that is absent.
 */
export function standingOf(picture: ClaudeApiKeyPicture | null, unknown: boolean, t: TFunction): Standing {
  if (unknown) {
    return {
      tone: 'neutral',
      base: null,
      clause: t('agents.claudeApi.standing.unknown', {
        defaultValue: 'Unknown — the door could not be read, so this is not the same as not set.',
      }),
    };
  }
  if (picture === null || !picture.set) {
    return {
      tone: 'neutral',
      base: null,
      clause: t('agents.claudeApi.standing.unset', {
        defaultValue: 'No key saved — this slot carries nothing.',
      }),
    };
  }

  const base = t('agents.claudeApi.standing.spent', {
    defaultValue: 'Spent this cycle {{spent}} of {{credit}}',
    spent: usd(picture.spent_usd),
    credit: usd(picture.credit_usd ?? 200),
  });

  const wall = picture.wall;
  if (wall) {
    if (wall.kind === 'refused') {
      return { tone: 'danger', base, clause: t('agents.claudeApi.standing.refused', { defaultValue: 'refused — save it again' }) };
    }
    if (wall.kind === 'credit') {
      return { tone: 'warn', base, clause: t('agents.claudeApi.standing.credit', { defaultValue: 'out of credit until {{when}}', when: formatDay(wall.until) }) };
    }
    if (wall.kind === 'spend') {
      return { tone: 'warn', base, clause: t('agents.claudeApi.standing.spend', { defaultValue: 'at its spend limit until {{when}}', when: formatDay(wall.until) }) };
    }
    if (wall.kind === 'rate') {
      return { tone: 'warn', base, clause: t('agents.claudeApi.standing.rate', { defaultValue: 'rate-limited until {{when}}', when: formatClock(wall.until) }) };
    }
    // A key should never carry a usage wall; if the door ever writes one, its own sentence is drawn
    // rather than a clause this card invented.
    return { tone: 'warn', base, clause: wall.detail };
  }

  if (picture.window.open) {
    return {
      tone: 'info',
      base,
      clause: t('agents.claudeApi.standing.window', { defaultValue: 'spending down until {{when}}', when: formatDay(picture.cycle_ends_at) }),
    };
  }
  if (picture.renews_day === null) {
    return {
      tone: 'neutral',
      base,
      clause: t('agents.claudeApi.standing.noRenewal', {
        defaultValue: 'no renewal day, so no window — set one to spend this credit down before it expires',
      }),
    };
  }
  return {
    tone: 'neutral',
    base,
    clause: picture.window.opens_at !== null
      ? t('agents.claudeApi.standing.opens', { defaultValue: 'window opens {{when}}', when: formatDay(picture.window.opens_at) })
      : t('agents.claudeApi.standing.opensUnknown', { defaultValue: 'window not open yet' }),
  };
}
