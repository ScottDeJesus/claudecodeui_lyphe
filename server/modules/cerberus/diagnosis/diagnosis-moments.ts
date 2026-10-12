/**
 * How a moment is written for the diagnosing agent: the center's local time, to the second, with the
 * zone's offset said once where "now" is given. The agent reads journal lines in `short-iso` (a local
 * time with its own offset), so a bare epoch number would be one more thing for it to convert, and a
 * wrong conversion is an invented "since 17:50".
 *
 * Consumers: `diagnosis-prompt.ts` (the check's `since`, its stored results, the clock) and
 * `diagnosis-history.ts` (the time that opens each history line).
 */

const pad = (value: number, width = 2): string => String(value).padStart(width, '0');

/** `2026-10-07 17:50:12` — the center's local date and time of an epoch-millisecond moment. */
export function localStamp(epochMs: number): string {
  const moment = new Date(epochMs);
  return (
    `${pad(moment.getFullYear(), 4)}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())} ` +
    `${pad(moment.getHours())}:${pad(moment.getMinutes())}:${pad(moment.getSeconds())}`
  );
}

/** `+02:00` — the center's UTC offset at that moment. */
export function localOffset(epochMs: number): string {
  const minutesEast = -new Date(epochMs).getTimezoneOffset();
  const sign = minutesEast < 0 ? '-' : '+';
  const abs = Math.abs(minutesEast);
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** `3 d 4 h`, `12 min`, `40 s` — a duration in milliseconds, its two largest units, never negative. */
export function durationText(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours} h` : `${hours} h ${minutes % 60} min`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days} d` : `${days} d ${hours % 24} h`;
}
