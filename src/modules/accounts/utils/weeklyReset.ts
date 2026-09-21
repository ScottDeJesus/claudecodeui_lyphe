/**
 * When each account's weekly quota turns over.
 *
 * The meter reads ONLY the live account — the other slots hold credential snapshots whose
 * access tokens expired days ago, and refreshing one would mutate the very auth state the
 * switcher exists to hold still. So there is no reading to fetch for a docked account, and the
 * schedule is the operator's own, given directly in `VITE_ACCOUNT_WEEKLY_RESETS`:
 * comma-separated `<slot slug>=<Weekday>@<HH:MM>` entries (`work=Friday@14:00,home=Tuesday@00:00`).
 * An account with no entry draws no reset line.
 *
 * The anchors are WALL-CLOCK times in `VITE_ACCOUNT_RESET_ZONE` (an IANA name; unset = the
 * reader's own zone), not fixed UTC offsets. That is the whole reason this file resolves them
 * through a zone rather than storing an hour offset: "Friday 2:00 PM" Pacific is 21:00 UTC in
 * PDT and 22:00 UTC in PST, and an account whose reset drifts an hour twice a year is worse than
 * no line at all.
 */

/** A name `Intl` refuses (`PDT`, a typo) falls back to the reader's zone: thrown from here it
 *  would reach render, and the whole app would go down over one config line. */
function resolveZone(): string {
  const own = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const given = String(import.meta.env?.VITE_ACCOUNT_RESET_ZONE ?? '').trim();
  if (given === '') return own;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: given });
    return given;
  } catch {
    console.warn(`VITE_ACCOUNT_RESET_ZONE "${given}" is not an IANA zone name; using ${own}.`);
    return own;
  }
}

const ZONE = resolveZone();

/** Sunday-first, matching `Date.prototype.getUTCDay`. */
const WEEKDAY_INDEX: Record<string, number> = {
  Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
};

type WeeklyAnchor = { weekday: number; hour: number; minute: number };

/** Keyed by the store's slot slug. A malformed entry is dropped rather than guessed at. */
const WEEKLY_RESETS: Record<string, WeeklyAnchor> = Object.fromEntries(
  String(import.meta.env?.VITE_ACCOUNT_WEEKLY_RESETS ?? '')
    .split(',')
    .flatMap((entry): [string, WeeklyAnchor][] => {
      const match = /^\s*([^=]+?)\s*=\s*([A-Za-z]+)@(\d{1,2}):(\d{2})\s*$/.exec(entry);
      const weekday = match
        ? WEEKDAY_INDEX[match[2][0].toUpperCase() + match[2].slice(1).toLowerCase()]
        : undefined;
      if (!match || weekday === undefined || Number(match[3]) > 23 || Number(match[4]) > 59) {
        return [];
      }
      return [[match[1], { weekday, hour: Number(match[3]), minute: Number(match[4]) }]];
    }),
);

/**
 * How far `ZONE` is from UTC at one instant, in milliseconds.
 *
 * Read off `Intl` rather than hard-coded, because that is what makes the whole file
 * DST-correct without a table of changeover dates: the platform's own tz database answers
 * -7h in July and -8h in January, and it keeps answering correctly when the rules change.
 */
function zoneOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(instant));

  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? '0');
  // `hour12: false` renders midnight as "24" on some ICU builds, so it is folded back to 0.
  const asIfUtc = Date.UTC(
    read('year'), read('month') - 1, read('day'),
    read('hour') % 24, read('minute'), read('second'),
  );
  return asIfUtc - instant;
}

/**
 * The instant at which the zone's wall clock reads the given date and time.
 *
 * Resolved twice on purpose. The first pass guesses the offset from the naive timestamp; on a
 * changeover weekend that guess can sit on the wrong side of the boundary, and the second pass
 * re-reads the offset at the instant the first one produced. Two passes settle every case the
 * tz database has, because an offset shift is at most an hour and the second read is already
 * inside the correct regime.
 */
function instantForZonedWallClock(year: number, month: number, day: number, hour: number, minute: number): number {
  const naive = Date.UTC(year, month, day, hour, minute);
  const firstPass = naive - zoneOffsetMs(naive);
  return naive - zoneOffsetMs(firstPass);
}

/** Today's calendar date and weekday in the zone, as the zone itself sees them right now. */
function pacificToday(now: number): { year: number; month: number; day: number; weekday: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    weekday: 'long',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(now));

  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    year: Number(read('year')),
    month: Number(read('month')) - 1,
    day: Number(read('day')),
    weekday: WEEKDAY_INDEX[read('weekday')] ?? 0,
  };
}

/**
 * The next time this account's weekly window turns over, or `null` for a slug with no anchor.
 *
 * A new account the store starts holding is exactly that `null` case: it gets no line rather than
 * a borrowed one, because a reset time under the wrong account's name is worse than none.
 */
export function nextWeeklyReset(slug: string, now: number = Date.now()): Date | null {
  const anchor = WEEKLY_RESETS[slug];
  if (!anchor) return null;

  const today = pacificToday(now);
  const daysAhead = (anchor.weekday - today.weekday + 7) % 7;

  // `Date.UTC` normalises a day past the month's end, so no month or year rollover is spelled here.
  let instant = instantForZonedWallClock(today.year, today.month, today.day + daysAhead, anchor.hour, anchor.minute);
  if (instant <= now) {
    instant = instantForZonedWallClock(today.year, today.month, today.day + daysAhead + 7, anchor.hour, anchor.minute);
  }
  return new Date(instant);
}

/**
 * How long until an instant, as days / hours / minutes — "2d 21h 14m".
 *
 * Truncated at every unit, never rounded: a countdown that rounds UP reads "3d" with 2d 23h
 * left and promises time the reader does not have. Units that are zero at the head are dropped
 * ("21h 14m", not "0d 21h 14m"); a zero in the MIDDLE is kept ("2d 0h 14m"), because dropping
 * it would read as 2 days 14 minutes.
 */
export function countdownInWords(target: Date, now: number = Date.now()): string {
  const msLeft = target.getTime() - now;
  if (msLeft <= 0) return 'now';

  const totalMinutes = Math.floor(msLeft / 60_000);
  if (totalMinutes < 1) return 'under a minute';

  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (days > 0 || hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(' ');
}

/**
 * The reset in words — "Weekly · Fri 2:00 PM · 2d 21h 14m".
 *
 * Written tight on purpose. The account rows are ~215px wide beside their avatar, and the long
 * form ("Weekly resets Friday 12:00 AM · in 6d 9h 46m") wrapped mid-phrase and stranded the
 * separator at the end of a line. "Weekly" leads because the row sits under a panel that also
 * meters a 5-hour window, and "Resets" alone would not say which.
 *
 * The clock face is rendered in the READER's zone, not forced to Pacific, matching how
 * `UsageMeters` already writes the live window's reset. For an operator in Pacific that prints
 * the anchor back exactly; for one elsewhere it prints the same instant in their own clock,
 * which is the question they actually have. The countdown needs no zone at all — a duration is
 * the same length everywhere.
 *
 * ⚠ The countdown is computed at RENDER and goes stale where nothing re-renders. Its callers
 * pass `now` from `useMinuteTick`, which is what keeps the figure honest while the panel is open.
 */
export function weeklyResetInWords(slug: string, now: number = Date.now()): string | null {
  const at = nextWeeklyReset(slug, now);
  if (!at) return null;
  const weekday = at.toLocaleDateString([], { weekday: 'short' });
  const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `Weekly · ${weekday} ${clock} · ${countdownInWords(at, now)}`;
}
