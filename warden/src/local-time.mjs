// Every time the warden shows or writes for a reader is LOCAL, with its offset: this machine's own clock, so a
// time in `status`, a directory listing or a release stamp reads the way the journal lines beside it do
// (`journalctl -o short-iso` is local with an offset). A stamp a machine also reads (`latest.json`'s `builtAt`) is
// `localIso`: the offset lets `Date.parse` take it, and it is never a `Z`.
//
// The offset is the MOMENT's own — `getTimezoneOffset` of that date, not of now — so a stamp from before a
// daylight-saving change carries the offset it had then. Center's `diagnosis-moments.ts` builds its form the same way.
//
// Consumers: `status.mjs` (`run`, `enrolled`), `diag-reads.mjs` (a listing's mtime), `../build.mjs` (`builtAt`).

const pad = (value, width = 2) => String(value).padStart(width, '0');

/**
 * The `Date` of a moment, or a `RangeError` for one that is no time: a damaged `identity.json` or `run.json` must stop
 * `status` with one line, not print a time made of `NaN` that reads like an answer.
 */
function momentOf(epochMs) {
  // `new Date(null)` is the epoch and `new Date(true)` a millisecond past it: only a number is a moment.
  if (typeof epochMs !== 'number') throw new RangeError('Invalid time value');
  const moment = new Date(epochMs);
  if (Number.isNaN(moment.getTime())) throw new RangeError('Invalid time value');
  return moment;
}

/** `-07:00` — the zone's offset from UTC at that moment. */
function offsetAt(moment) {
  // Rounded: a zone from before standard time may carry seconds, and an offset here is whole minutes.
  const minutesEast = -Math.round(moment.getTimezoneOffset());
  const sign = minutesEast < 0 ? '-' : '+';
  const magnitude = Math.abs(minutesEast);
  return `${sign}${pad(Math.floor(magnitude / 60))}:${pad(magnitude % 60)}`;
}

function dateAndTime(moment) {
  return (
    `${pad(moment.getFullYear(), 4)}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}` +
    `T${pad(moment.getHours())}:${pad(moment.getMinutes())}:${pad(moment.getSeconds())}`
  );
}

/** `2026-10-07 08:59:32 -07:00` — the local date, the time to the second, and the offset at that moment. For a person. */
export function localStamp(epochMs) {
  const moment = momentOf(epochMs);
  return `${dateAndTime(moment).replace('T', ' ')} ${offsetAt(moment)}`;
}

/** `2026-10-07T08:59:32.469-07:00` — the same moment as an ISO stamp with its own offset. For a file a machine reads. */
export function localIso(epochMs) {
  const moment = momentOf(epochMs);
  return `${dateAndTime(moment)}.${pad(moment.getMilliseconds(), 3)}${offsetAt(moment)}`;
}
