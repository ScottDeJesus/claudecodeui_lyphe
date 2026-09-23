/**
 * A cron expression as plain words — the `scheduleText` a registry row carries.
 *
 * The rules are CLOSED on purpose. A schedule this module cannot say is handed back exactly as
 * the box wrote it, never approximated, because the two kinds of answer are otherwise
 * indistinguishable to everyone who reads the screen: `7 3 2 6 5` says "the registry has no
 * phrase for this" and prompts a look at the line, while a plausible "every day at 03:07" would
 * be a claim about a schedule nobody checked — and a wrong one, silently. So the fallback is the
 * expression itself, and every rule that does fire is narrow enough to be read off the fields.
 *
 * Pure: no clock, no I/O, no import at all. An expression in, one phrase (or that expression)
 * out, which is what lets the sync's `reconcile` stay provable against handmade input.
 */

/** The weekdays cron numbers, with Sunday spelled twice: `0` and `7` are both it. */
const WEEKDAYS_BY_NUMBER: Record<string, string> = {
  '0': 'Sunday',
  '1': 'Monday',
  '2': 'Tuesday',
  '3': 'Wednesday',
  '4': 'Thursday',
  '5': 'Friday',
  '6': 'Saturday',
  '7': 'Sunday',
};

/** The same weekdays by their three-letter spelling, which cron also accepts. */
const WEEKDAYS_BY_NAME: Record<string, string> = {
  sun: 'Sunday',
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
};

/** The macros, in the words cron's own man page uses for the thing each one schedules. */
const MACRO_PHRASES: Record<string, string> = {
  '@yearly': 'every year on 1 January at 00:00',
  '@annually': 'every year on 1 January at 00:00',
  '@monthly': 'every month on day 1 at 00:00',
  '@weekly': 'every Sunday at 00:00',
  '@daily': 'every day at 00:00',
  '@midnight': 'every day at 00:00',
  '@hourly': 'every hour at :00',
  '@reboot': 'at every reboot',
};

/** Whether a field is cron's "any", which is what most of these rules key off. */
function isEvery(field: string): boolean {
  return field === '*';
}

/** Whether a field is a plain number cron would accept for that position. */
function isNumber(field: string, maximum: number): boolean {
  return /^\d{1,2}$/.test(field) && Number(field) <= maximum;
}

/** A clock field as the phrase spells it: `:07`, `04:23` — two digits, always. */
function pad(value: string | number): string {
  return String(value).padStart(2, '0');
}

/** `every minute` for a step of one: "every 1 minutes" is not a sentence anyone writes. */
function everyMinutes(step: number): string {
  return step === 1 ? 'every minute' : `every ${step} minutes`;
}

/** The weekday a day-of-week field names, or null when it names one this module cannot say. */
function weekdayName(field: string): string | null {
  return WEEKDAYS_BY_NUMBER[field] ?? WEEKDAYS_BY_NAME[field.toLowerCase()] ?? null;
}

/**
 * The expression in plain words, or the expression itself when no rule covers it.
 *
 * A five-field line is read left to right and asked, in order: is this the user's `crontab`
 * shape (five fields), a macro, an every-hour or every-N-minutes schedule, then a fixed minute
 * and hour qualified by which of the three date fields cron uses. Anything that falls past the
 * last question — a list, a step on the hour, a range without one, a day rule combined with a
 * month — leaves by the identical door: the caller's own string, untouched.
 */
export function describeCron(expression: string): string {
  const trimmed = expression.trim();

  const macro = MACRO_PHRASES[trimmed];
  if (macro !== undefined) return macro;

  const fields = trimmed.split(/\s+/);
  if (fields.length !== 5) return expression;

  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const everyDay = isEvery(dayOfMonth) && isEvery(month) && isEvery(dayOfWeek);

  if (everyDay && isEvery(hour)) {
    if (isNumber(minute, 59)) return `every hour at :${pad(minute)}`;

    const step = /^\*\/(\d+)$/.exec(minute);
    if (step !== null && Number(step[1]) >= 1) return everyMinutes(Number(step[1]));

    const range = /^(\d{1,2})-(\d{1,2})\/(\d+)$/.exec(minute);
    if (range !== null && Number(range[3]) >= 1) {
      return `${everyMinutes(Number(range[3]))} from :${pad(range[1])} to :${pad(range[2])}`;
    }

    return expression;
  }

  if (!isNumber(minute, 59) || !isNumber(hour, 23)) return expression;

  if (everyDay) return `every day at ${pad(hour)}:${pad(minute)}`;

  const named = isEvery(dayOfMonth) && isEvery(month) ? weekdayName(dayOfWeek) : null;
  if (named !== null) return `every ${named} at ${pad(hour)}:${pad(minute)}`;

  if (isEvery(month) && isEvery(dayOfWeek) && isNumber(dayOfMonth, 31) && Number(dayOfMonth) >= 1) {
    return `day ${Number(dayOfMonth)} of every month at ${pad(hour)}:${pad(minute)}`;
  }

  return expression;
}
