import type { ClaudeAccountRow, ClaudeDoorPicture, ClaudeUsage, ClaudeUsagePace, ClaudeUsageWindow } from '@/shared/types';

/**
 * THE METERS FOLLOW THE ACCOUNT IN USE, WHICH IS NO LONGER ALWAYS THE BOX'S LIVE LOGIN.
 *
 * `GET /api/usage` measures the login whose credential file the box holds — `liveAccountDigest()` —
 * and that is the right reading only while the account in use is that same login. Once the store
 * chooses another account (a checked sign-in token, `chosen.json`'s digest), the route's figures are
 * still the outgoing login's, and drawing them under the incoming account's name would be a number
 * under the wrong owner. The door's picture carries every account's newest reading and the pacer's
 * projection of it, so this file turns the account in use's row into the very `ClaudeUsage` the meters
 * already draw — same keys, same units, no second renderer and no change to `UsageMeters`.
 *
 * THIS IS THE ONE PLACE THE DOOR'S FRACTIONS BECOME PERCENT. The door relays `reading.five`/`.week`
 * and its `pace` figures as fractions 0..1 (window POINTS, INV-4299 — never dollars); the meters take
 * percent and do no arithmetic, so the conversion happens here, once, and nowhere else.
 */

/** Three minutes: the age past which a reading from the picture is drawn as old rather than current. */
const PICTURE_READING_STALE_MS = 3 * 60_000;

/** The two windows every account row states, and the labels the meters already give them. */
const FIVE_HOUR = { key: 'five_hour', label: 'Current 5-hour window' } as const;
const WEEKLY = { key: 'seven_day', label: 'This week' } as const;

/** A fraction 0..1 as the wire's whole percent — the same rounding `usage.service.ts` applies. */
function points(fraction: number): number {
  return Math.round(fraction * 100);
}

/** Epoch SECONDS → the ISO-8601 stamp `ClaudeUsageWindow.resetsAt` carries; `null` stays `null`. */
function resetStamp(seconds: number | null): string | null {
  return seconds === null ? null : new Date(seconds * 1000).toISOString();
}

/** A window nobody has measured reads as an em-dash over an empty track, never as zero used. */
function unmeasuredWindow(window: { key: string; label: string }): ClaudeUsageWindow {
  return { key: window.key, label: window.label, percent: null, resetsAt: null };
}

/**
 * The row's pace (fractions) as `ClaudeUsage.pace` (percent), the shape `UsageMeters` already reads.
 * The row carries only where each window PROJECTS and its ceiling; the used figure is the reading's
 * own, and `words` is empty because the rule's caption belongs to the live route's picture, not to a
 * filed reading. `undefined` when the pacer could weigh neither window — `ClaudeUsage.pace` is ABSENT
 * on a reading with no pace, exactly like the route's absent key.
 */
function paceInPercent(row: ClaudeAccountRow, five: number | null, week: number | null): ClaudeUsagePace | undefined {
  const pace = row.pace;
  if (pace === null) return undefined;
  return {
    used5: five,
    projected5: pace.five === null ? null : points(pace.five.projected),
    ceiling5: pace.five === null ? null : points(pace.five.ceiling),
    used7: week,
    projected7: pace.week === null ? null : points(pace.week.projected),
    ceiling7: pace.week === null ? null : points(pace.week.ceiling),
    words: '',
  };
}

/**
 * The account in use, as the door marks it.
 *
 * The door puts `in_use` on exactly one row: the chosen account when it holds a checked token, else
 * the live login (`store.current()`). So the mark, not a guess assembled from `chosen` and `live`, is
 * the answer — and a picture the door could not answer has no account in use at all.
 */
export function accountInUse(picture: ClaudeDoorPicture | null | undefined): ClaudeAccountRow | null {
  if (picture === null || picture === undefined || 'reachable' in picture) return null;
  return picture.accounts.find((account) => account.in_use) ?? null;
}

/**
 * The account in use's newest reading and pace, as the two-window `ClaudeUsage` the meters draw.
 *
 * `degraded: true` and `staleSince` — the reading's own filed-at stamp, epoch seconds — appear only
 * once the reading is older than three minutes, so the meters dim the bars and say "as of" instead
 * of presenting a filed figure as a fresh measurement. The reason is the usage route's own when that
 * body is degraded (it is the live attempt that failed); otherwise empty, which the meters word as
 * "the provider gave no figures" — true of the last three minutes even when older ones are drawn.
 */
function pictureReading(row: ClaudeAccountRow, usage: ClaudeUsage | null, nowMs: number): ClaudeUsage {
  const reading = row.reading;
  if (reading === null) {
    return {
      reachable: true,
      account: row.digest,
      windows: [unmeasuredWindow(FIVE_HOUR), unmeasuredWindow(WEEKLY)],
      degraded: false,
      reason: '',
      staleSince: null,
      checkedAt: Math.floor(nowMs / 1000),
    };
  }

  const five = points(reading.five);
  const week = points(reading.week);
  const stale = nowMs - reading.at * 1000 > PICTURE_READING_STALE_MS;
  const usageExplains = usage !== null && usage.reachable && usage.degraded ? usage.reason : '';
  const pace = paceInPercent(row, five, week);

  return {
    reachable: true,
    account: row.digest,
    windows: [
      { key: FIVE_HOUR.key, label: FIVE_HOUR.label, percent: five, resetsAt: resetStamp(reading.five_resets) },
      { key: WEEKLY.key, label: WEEKLY.label, percent: week, resetsAt: resetStamp(reading.week_resets) },
    ],
    degraded: stale,
    reason: stale ? usageExplains : '',
    staleSince: stale ? reading.at : null,
    checkedAt: reading.at,
    // The key stays absent, not null, when the pacer could weigh neither window.
    ...(pace === undefined ? {} : { pace }),
  };
}

/**
 * The `ClaudeUsage` the account panel's meters draw.
 *
 * Used by the accounts module's AccountPopover (the meters) and AccountFooterRow (the closed row's
 * two windows), so both registers name the same account and show the same figures.
 *
 * The route's body wins when it belongs to the account in use and is healthy — it is a measurement
 * taken now, fresher than anything filed. Every other case falls back to the account in use's newest
 * reading from the door's picture. With no account in use to name (no picture yet, or a door that
 * could not answer) the route's body is passed through untouched, which is exactly what the panel
 * drew before this file existed.
 */
export function accountInUseUsage(
  usage: ClaudeUsage | null,
  picture: ClaudeDoorPicture | null | undefined,
  nowMs: number,
): ClaudeUsage | null {
  const row = accountInUse(picture);
  if (row === null) return usage;
  if (usage !== null && usage.reachable && !usage.degraded && usage.account === row.digest) return usage;
  return pictureReading(row, usage, nowMs);
}
