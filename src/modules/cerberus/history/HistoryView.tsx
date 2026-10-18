import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { EventsCard } from '@/modules/cerberus/history/EventsCard';
import { LookupCard } from '@/modules/cerberus/history/LookupCard';
import { useActivityFeed } from '@/modules/cerberus/hooks/useActivityFeed';
import { useCheckDetail } from '@/modules/cerberus/hooks/useCheckDetail';
import { toTimelineEvent } from '@/modules/cerberus/utils/activityEvents';
import { dateOf, dayAndTime, hm, hms, momentOf, sameLocalDay } from '@/modules/cerberus/utils/cerberusTime';
import { api } from '@/shared/api';
import type { CerberusCell, CerberusCheckIndexEntry, CerberusCheckView, CerberusOverview } from '@/shared/cerberus-types';

const SECOND_MS = 1_000;

/** A moment floored to its whole second, the grain the time field holds. */
const secondOf = (ms: number): number => Math.floor(ms / SECOND_MS) * SECOND_MS;

/**
 * The index of every active check (`GET /api/cerberus/checks`) and how far this browser's clock runs
 * ahead of center's, or `null` when it did not answer with an index. The lead comes off the answer's
 * own `Date` header, center's clock to the second: a header that is missing, or a browser that is
 * behind, is a lead of 0. It is read the moment the headers arrive, so it is good to about a second.
 */
async function readIndex(): Promise<{ entries: CerberusCheckIndexEntry[]; clockLead: number } | null> {
  try {
    const response = await api.cerberus.checks();
    if (!response.ok) return null;
    const centerNow = Date.parse(response.headers.get('date') ?? '');
    const clockLead = Number.isNaN(centerNow) ? 0 : Math.max(0, Date.now() - centerNow);
    const body: unknown = await response.json();
    return Array.isArray(body) ? { entries: body as CerberusCheckIndexEntry[], clockLead } : null;
  } catch {
    // No answer at all, or a body that is not JSON: this app's own network. The card says so and
    // offers Try again.
    return null;
  }
}

/**
 * Whether `a` has needed a person longer than `b`: the older `since`, an unknown one never older than a
 * known one; then the key, then the node, so a tie always lands on the same check.
 */
function waitedLonger(a: CerberusCheckView, b: CerberusCheckView): boolean {
  const sinceA = a.since ?? Number.POSITIVE_INFINITY;
  const sinceB = b.since ?? Number.POSITIVE_INFINITY;
  if (sinceA !== sinceB) return sinceA < sinceB;
  if (a.key !== b.key) return a.key < b.key;
  return a.node < b.node;
}

/**
 * The check a look-up opens on, as `<node>/<key>`: the one that has needed a person longest, else the
 * index's first. It is picked here from every need, because the overview lists them worst first, not
 * by `since`. `checks` is never empty here.
 */
function firstChoice(checks: CerberusCheckIndexEntry[], overview: CerberusOverview | null): string {
  let longest: CerberusCheckView | undefined;
  for (const { check } of overview?.needsYou ?? []) {
    if (longest === undefined || waitedLonger(check, longest)) longest = check;
  }
  const entry = checks.find((candidate) => candidate.node === longest?.node && candidate.key === longest?.key) ?? checks[0];
  return `${entry.node}/${entry.key}`;
}

/**
 * A chosen `<node>/<key>` as `useCheckDetail` names a check: the node, the service (the key up to its
 * first `/`) and the id (the rest). Blank when nothing is chosen, which makes the hook read nothing.
 */
function checkOf(chosen: string | null): { node: string; service: string; id: string } {
  if (chosen === null) return { node: '', service: '', id: '' };
  const [node, service, ...id] = chosen.split('/');
  return { node, service, id: id.join('/') };
}

/**
 * HISTORY, the operator's "live scrub" made real. A real store keeps every change, so any check can
 * be looked up at any date and second, with the hour up to that moment and the changes of the three
 * hours before it. Beside that is everything that happened, newest first and paged.
 *
 * Two cards that wrap: the look-up takes three parts of the width and the feed two. Below about
 * 820 px (460 + 340 + the gap) they stack, the look-up first, because it is what the view is for.
 * The padding follows the panel's own width (`cqi`), as the prototype's views do.
 *
 * The look-up's reads and presses are here; the feed's, with its paging, are `useActivityFeed`'s.
 * The cards only draw what they are handed.
 *
 * Mounted by the tab's root, `CerberusPanel`, as its History view.
 */
export function HistoryView() {
  const { t } = useTranslation();
  const { overview, unreachable } = useCerberus();

  // Every active check, as the picker lists them, or `null` until the index answers. Essential: the
  // picker's options and the default choice come from it, and "not read yet" has to look different
  // from "no checks at all".
  const [checks, setChecks] = useState<CerberusCheckIndexEntry[] | null>(null);

  // True while the latest read of the index did not answer. Essential: it turns the picker's
  // placeholder into the banner with its Try again; a read that is out clears it.
  const [checksFailed, setChecksFailed] = useState(false);

  // How many times the index has been asked for: the view opening is the first, each Try again adds
  // one. Essential: the read below runs again exactly when it changes.
  const [indexAsks, setIndexAsks] = useState(1);

  // The moment the view opened, fixed. Essential: the date, the time and the first look-up all start
  // there, and it stands in for the clock until the overview's first read.
  const [opened] = useState(() => Date.now());

  // How far this browser's clock runs ahead of center's, in ms (0 when it does not), from the index
  // read. Essential: center answers "That hasn't happened yet" to a second its own clock has not
  // reached, so a pick on the running minute is held to center's clock with it; nothing derives it.
  const [clockLead, setClockLead] = useState(0);

  // The check looked up, as `<node>/<key>`, or `null` until one is chosen: first the check that has
  // needed a person longest, else the index's first. Essential: it is what the person picked, and the
  // read below is about it.
  const [chosen, setChosen] = useState<string | null>(null);

  // The date field's text, "YYYY-MM-DD": today at first, "" while the field is cleared. Essential: a
  // half-edited field has no moment, so the text cannot be derived from one.
  const [date, setDate] = useState(() => dateOf(opened));

  // The time field's text, "HH:MM:SS": now at first, "" while it is half typed. Essential, as the date is.
  const [time, setTime] = useState(() => hms(opened));

  // The last whole moment the two fields named, epoch ms: the one the look-up and the hour stand at.
  // Essential: while a field is not whole the last whole moment stands, and nothing derives that.
  const [moment, setMoment] = useState(() => secondOf(opened));

  // The index is read once, when the view opens, and again only on Try again. A check retired since
  // is the detail's 'gone', so the index is never polled.
  useEffect(() => {
    let live = true;
    void readIndex().then((index) => {
      if (!live) return;
      if (index === null) {
        setChecksFailed(true);
        return;
      }
      setChecks(index.entries);
      setClockLead(index.clockLead);
      // The opening look-up is held to center's clock before any read is made at it (the first read
      // waits for the check this answer lets be chosen): a browser clock ahead of center's would open
      // on a second that has not happened. Fields the person already changed are left as they are.
      const opening = secondOf(opened);
      const held = secondOf(opened - index.clockLead);
      setMoment((was) => (was === opening ? held : was));
      setDate((was) => (was === dateOf(opening) ? dateOf(held) : was));
      setTime((was) => (was === hms(opening) ? hms(held) : was));
    });
    return () => {
      live = false;
    };
  }, [indexAsks, opened]);

  // The first choice waits for the overview (or its failure) so the check that needs a person is the
  // one chosen, and is made once: a later read never moves a look-up the person is reading.
  if (chosen === null && checks !== null && checks.length > 0 && (overview !== null || unreachable)) {
    setChosen(firstChoice(checks, overview));
  }

  const { detail, error, refresh } = useCheckDetail({ ...checkOf(chosen), lookupAt: moment, end: moment });

  // The moment the view stands at, one for both cards: center's clock as the overview last read it,
  // which the provider reads again on every frame and every 30 s, so "today" turns at midnight. The
  // moment the view opened stands in until that first read. A row or an answer on another local day
  // prints its date.
  const now = overview?.now ?? opened;

  const feed = useActivityFeed();

  const events = feed.lines === null ? null : feed.lines.map((line) => toTimelineEvent(line, t, now));
  const oldest = feed.lines === null ? undefined : feed.lines[feed.lines.length - 1];
  const since = oldest === undefined ? null : sameLocalDay(oldest.at, now) ? hm(oldest.at) : dayAndTime(oldest.at);

  /** A date or time typed: the text is held as typed, and the moment follows once both fields are whole. */
  const typed = (nextDate: string, nextTime: string) => {
    setDate(nextDate);
    setTime(nextTime);
    const whole = momentOf(nextDate, nextTime);
    if (whole !== null) setMoment(whole);
  };

  /**
   * A minute pressed in the strip: the look-up goes to its last second, or to now (center's now, by
   * the clock lead) while that second is still to come. The date is the minute's own, so an hour that
   * crosses midnight starts the day before.
   */
  const pickMinute = (cell: CerberusCell) => {
    const second = secondOf(Math.min(cell.to - SECOND_MS, Date.now() - clockLead));
    setDate(dateOf(second));
    setTime(hms(second));
    setMoment(second);
  };

  /** Try again on the look-up card: the index while it has not answered, else the chosen check's read. */
  const retryLookup = () => {
    if (checks === null) {
      setChecksFailed(false);
      setIndexAsks((asks) => asks + 1);
    } else {
      void refresh();
    }
  };

  return (
    <div className="flex flex-wrap items-start gap-5 px-[clamp(16px,4cqi,32px)] pb-7 pt-5">
      <div className="min-w-0 flex-[3_1_460px]">
        <LookupCard
          checks={checks}
          checksFailed={checksFailed}
          chosen={chosen}
          date={date}
          time={time}
          detail={detail}
          failure={error}
          now={now}
          onCheck={setChosen}
          onDate={(next) => typed(next, time)}
          onTime={(next) => typed(date, next)}
          onPick={pickMinute}
          onRetry={retryLookup}
        />
      </div>
      <div className="min-w-0 flex-[2_1_340px]">
        <EventsCard
          events={events}
          since={since}
          failed={feed.failed}
          earlier={feed.earlier}
          openIndex={feed.openIndex}
          onToggle={feed.toggle}
          onEarlier={() => void feed.loadEarlier()}
          onRetry={feed.retry}
        />
      </div>
    </div>
  );
}
