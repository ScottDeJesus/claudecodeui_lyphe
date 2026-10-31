import { formatShortDate } from '@/shared/utils';

/** Which day a stamp falls on, as the page's clock reads it now: this day, the one before it, or any day earlier (or later). */
type StationStampDay = 'today' | 'yesterday' | 'before';

/** One stamp, cut into the three things a reader words with: its day, the locale's clock and the page's spelling of the day. */
type StationStamp = { day: StationStampDay; clock: string; date: string };

/**
 * THE STATION'S ONE STAMP WRITER: every time the page draws as a moment, on his clock and in the locale's. Its readers each word
 * the three parts with keys of their own, so a clock is spelled in one place and said in four:
 * - the strip (`SinceYouLastLooked`: each landing's time and his last look, `station.strip.when.*`);
 * - the memory lines (`MemoryLine`: when he said it, `station.memory.when.*`);
 * - the chat stage (`ChatStage`: "last moved <when>", `station.chat.when.*`);
 * - a red check's "since" (`NeedItem`, `station.needs.when.*`).
 *
 * `clock` is the locale's time of day ("2:04 PM", "14:04"); `date` is the page's one spelling of a day (`formatShortDate`:
 * "Oct 26", with its year once it is not this year's). The day is compared on the calendar and never on a count of hours, so a
 * landing at 23:50 reads "yesterday" at 00:10. A stamp that is not a time (`NaN`, an unparseable string) is `null`: the reader
 * draws nothing for it.
 *
 * Her spoken words keep the clock she says them in (`actionWords.ts`, the action's lapse, 24-hour): what she says is also
 * written as she says it, so that one is not this writer's.
 */
export function stationStamp(at: string | number): StationStamp | null {
  const moment = new Date(at);
  if (Number.isNaN(moment.getTime())) return null;
  const clock = moment.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const date = formatShortDate(moment.toISOString()) ?? '';
  const now = new Date();
  if (moment.toDateString() === now.toDateString()) return { day: 'today', clock, date };
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return { day: moment.toDateString() === yesterday.toDateString() ? 'yesterday' : 'before', clock, date };
}
