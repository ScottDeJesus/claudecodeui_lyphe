import { CalendarSearchIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EntrySheet } from '@/modules/scheduling-report/EntrySheet';
import { MachineCallsChip } from '@/modules/scheduling-report/MachineCallsChip';
// FILL: fake — this import leaves with scheduling-fake.ts and the fake/ folder beside it, which the fill deletes: the two reads and the seven presses below take its place.
import { FAKE_READS, unwired } from '@/modules/scheduling-report/scheduling-fake';
import { SchedulingBody } from '@/modules/scheduling-report/SchedulingBody';
import { SchedulingHead } from '@/modules/scheduling-report/SchedulingHead';
import { SchedulingPills } from '@/modules/scheduling-report/SchedulingPills';
import { TroubleBanner } from '@/modules/scheduling-report/TroubleBanner';
import type { SchedulingFilters, SchedulingPillKey, SchedulingTally, SchedulingWindow } from '@/modules/scheduling-report/utils/schedulingModel';
import { agoWord } from '@/modules/scheduling-report/utils/schedulingWords';
import { EmptyState } from '@/shared/ui';

type SchedulingViewProps = {
  /** Whether the Cerberus tab is showing this view. The tab keeps it mounted while hidden: hidden, it reads nothing and raises no sheet. */
  shown: boolean;
};

/** A block arriving: Verve's page entrance, as the Cerberus tab's own views enter. */
const ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

/**
 * THE SCHEDULING VIEW: what happens when someone schedules in Restorly. Every use of the Schedule-a-visit form (what
 * Restorly offered, what was chosen, each press and its answer, the visit as it stands now) and every change made straight
 * on the grid or through the API is an ENTRY, called a session on screen, and this view answers, for a window of days:
 * how many there were and how they ended, which hit a speed bump and why, how often and when people schedule, and which
 * door they start from.
 *
 * READ-ONLY. Cerberus watches; Restorly is where a person schedules. Nothing here books, changes or cancels a visit, on
 * the view or in an entry's sheet.
 *
 * IT STANDS UNDER THE TAB'S OWN HEADER, which carries the page's one big headline. So this view's head is a section's
 * heading, a size down, and never a second page title.
 *
 * Read top to bottom: the head (the answer in a headline, the summary, the window switch and Refresh); five pills, each
 * a press that carries the reader to its section; the body (By what was done, How often and Where it starts beside
 * Sessions); and one entry's sheet over the tab when a row is pressed. There is no Live now and no heal section: a use
 * of the form takes about a minute, and nothing files scheduling friction yet.
 *
 * A MACHINE'S ENTRY is listed only behind Machine calls and is counted in no figure: not the head's, the pills' or a
 * kind's. Listed, it is drawn grey, and it is How often's grey part.
 *
 * The root is the view's data hub. It holds three things of its own (the window, the filters, the open entry) and is
 * handed the rest as two reads, `SchedulingRead` and `EntrySheetRead` (`utils/schedulingModel.ts`); the parts draw what
 * they are given. It reads on show, on a press and when the feed says something moved, never on a timer and never while
 * hidden (MAN-8918). Words are `cerberus.scheduling.*`; a login, a customer, a person's name, a code and a reason's
 * detail are data.
 *
 * Used by the cerberus module's `CerberusPanel`, through this module's barrel, as the seventh view of its strip.
 */
export function SchedulingView({ shown }: SchedulingViewProps) {
  const { t } = useTranslation();

  // The window on screen, in days. Held here so it survives a visit to another view of the tab, and so the read follows one value.
  const [days, setDays] = useState<SchedulingWindow>(30);
  // What the view is narrowed to. Held at the root, not in the list: two of the three are asked of the server, so the read needs them.
  const [filters, setFilters] = useState<SchedulingFilters>({ by: null, machines: false, bumpsOnly: false });
  // The entry the sheet is open on, by its id; null while it is closed. Held beside the reads, since it names what the sheet's read asks for and comes back with the view.
  const [openId, setOpenId] = useState<string | null>(null);
  // The pill last pressed, whose section the reader was carried to; null until one is, so no pill reads as a filter in force.
  const [activePill, setActivePill] = useState<SchedulingPillKey | null>(null);

  // ── The reads: on show, on a press and on a feed frame; never on a timer, never while hidden. ──
  // FILL: useSchedulingRead — useSchedulingRead({ shown, window: days, filters }) → { read: SchedulingRead, feed, readAt, refresh, retry }: the window's entries, read on every show, on a window or server-side filter change and on a press, and told by the feed while shown. `readAt` is when the newest read settled, answered or failed, as epoch ms.
  // FILL: entriesToBuckets — utils/entriesToBuckets.ts, pure, called inside that hook: the overview's entries as `@/shared/dayBuckets` items by when each started (a machine's the `test` part, a person's `clean` or `hiccup` by its verdict), for `read.days` and `read.hours`.
  const { read, readAt } = FAKE_READS.window(t);
  // FILL: useEntrySheet — useEntrySheet(shown ? openId : null, feed) → { sheet: EntrySheetRead, retry: retrySheet }: the open entry, read on open and again on a coalesced feed frame; nothing while the sheet is shut or the view hidden.
  const sheet = FAKE_READS.sheet(t, shown ? openId : null);
  // The clock every age on the view is counted from: the moment the newest read settled. A failed read moves it too, which
  // is what lets the stale strip say how old the answer on screen is. Nothing here ticks: no entry is ever live, so an
  // age is true as of the last time the screen asked, and the view holds no timer at all (MAN-8918).
  const now = readAt;

  // ── The presses. None writes: they change what is read and what is shown. ──
  // FILL: onWindow — setDays(next). The window is part of the overview's key, so the change reads the overview again.
  const onWindow: (next: SchedulingWindow) => void = unwired({ days: setDays });
  // FILL: onFilter — setFilters(next). A changed `by` or `machines` reads the overview again; `bumpsOnly` alone is the browser's own and reads nothing. When the answer to a Machine calls press moves its chip between the empty state and the Sessions list, keyboard focus follows it (`[data-scheduling-machines-chip] button`), as UploadsView does for Test runs.
  const onFilter: (next: SchedulingFilters) => void = unwired({ filters: setFilters });
  // FILL: onRefresh — refresh(): reads the overview again and dials the feed again if it was refused, keeping the screen as it is until the new answer lands.
  const onRefresh: () => void = unwired();
  // FILL: onOpenEntry — setOpenId(id): the sheet opens on that entry, and its read begins.
  const onOpenEntry: (id: string) => void = unwired({ openId: setOpenId });
  // FILL: onCloseEntry — setOpenId(null): Escape, the sheet's ✕ and its scrim.
  const onCloseEntry: () => void = unwired({ openId: setOpenId });
  // FILL: onRetry — retry() and retrySheet(): Try again on the view's banner, on the stale strip and in the sheet reads again whichever of the two failed.
  const onRetry: () => void = unwired();
  // FILL: onPill — setActivePill(key), then the section that pill's figure counted is brought into view: `sessions`, `closed` and `last` go to #scheduling-sessions, `bumps` and `booked` to #scheduling-kinds (scrollIntoView, block 'start'; behaviour 'auto' under prefers-reduced-motion, else 'smooth'), as UploadsView's onPill does.
  const onPill: (key: SchedulingPillKey) => void = unwired({ pill: setActivePill });

  const overview = read.overview;

  if (overview === null) {
    return (
      <div className="flex min-w-0 max-w-[1180px] flex-col gap-5 px-[clamp(16px,4cqi,32px)] pb-7 pt-5" data-scheduling-view={read.phase}>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t('cerberus.scheduling.head.eyebrow')}</p>
        {read.phase === 'trouble' ? (
          // STATE: THE FIRST READ FAILED. There is no answer to show, so the view is its own banner: the lane's sentence and
          // Try again. Warn, not danger: nothing was refused, Restorly's server did not answer, and the next read may.
          <div role="alert" className={`max-w-xl ${ENTER}`}>
            <TroubleBanner title={t('cerberus.scheduling.trouble.title')} detail={read.trouble} retry={t('cerberus.scheduling.trouble.retry')} onRetry={onRetry} />
          </div>
        ) : (
          // STATE: THE FIRST READ IS OUT. Held back 150 ms, so a fast read never flashes it; then the view's own shape in
          // shimmering blocks (a headline, the pills, the kinds and the two pictures beside the sessions' rows), so
          // nothing jumps when the answer lands.
          <div role="status" aria-busy="true" aria-label={t('cerberus.scheduling.loading')} className="flex animate-[vv-fade_200ms_ease_150ms_both] flex-col gap-5 [container-type:inline-size]">
            <div className="vv-skeleton h-9 w-72 max-w-full" />
            <div className="vv-skeleton h-11" />
            <div className="grid gap-x-8 gap-y-3 [@container(min-width:48rem)]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((row) => <div key={row} className="vv-skeleton h-11" />)}
                <div className="vv-skeleton mt-3 h-24" />
              </div>
              <div className="flex flex-col gap-2">{[0, 1, 2, 3, 4].map((row) => <div key={row} className="vv-skeleton h-[68px]" />)}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // The window's sessions, counted for the head and the pills: people's alone, so a machine's call is in none of these whether or not it is listed.
  const people = overview.entries.filter((entry) => entry.actor_kind === 'person');
  const tally: SchedulingTally = {
    sessions: people.length,
    bumps: people.filter((entry) => entry.verdict === 'hiccup').length,
    booked: people.filter((entry) => entry.result === 'booked').length,
    changed: people.filter((entry) => entry.result === 'changed').length,
    cancelled: people.filter((entry) => entry.result === 'cancelled').length,
    // A booking form that was closed with nothing booked. A form opened on a visit and closed is not one (that is how a visit is looked at), and a form still open has not been closed.
    closed: people.filter((entry) => entry.form && entry.kind === 'book' && entry.result === 'nothing' && entry.state !== 'open').length,
    last: people[0] ?? null,
  };
  // The window holds no entry at all, and no person was asked for: an empty window, not a filter that matched nothing.
  const emptyWindow = overview.entries.length === 0 && filters.by === null;
  // Whether each pill has somewhere to carry the reader: none of them over an empty window, which has no section.
  const canGo: Record<SchedulingPillKey, boolean> = { sessions: !emptyWindow, bumps: !emptyWindow, booked: !emptyWindow, closed: !emptyWindow, last: !emptyWindow };
  const wider = ([30, 90] as SchedulingWindow[]).find((length) => length > days);
  // The open entry as the overview lists it, so the sheet's head stands before the entry's own read answers.
  const opened = openId === null ? null : overview.entries.find((entry) => entry.id === openId) ?? null;

  return (
    // The view is its own size container: the body's two columns follow the view's width, never the window's.
    <div className="min-w-0 max-w-[1180px] px-[clamp(16px,4cqi,32px)] pb-7 pt-5" data-scheduling-view={read.stale ? 'stale' : 'ready'}>
      <div className={`flex min-w-0 flex-col gap-5 [container-type:inline-size] ${ENTER}`}>
        <SchedulingHead days={days} tally={tally} truncated={overview.truncated} filters={filters} now={now} onWindow={onWindow} onRefresh={onRefresh} onFilter={onFilter} />

        {read.stale && (
          // STATE: A READ FAILED AFTER A GOOD ONE. The last answer stays on screen, and this strip says it is the last answer,
          // not this minute's, and HOW OLD it is: a monitor that cannot see must never look current, and the age is what
          // tells a reader whether what is under the strip is still worth reading.
          <div role="alert">
            <TroubleBanner title={t('cerberus.scheduling.trouble.stale', { ago: agoWord(t, overview.generated_at, now) })} detail={read.trouble} retry={t('cerberus.scheduling.trouble.retry')} onRetry={onRetry} />
          </div>
        )}

        <SchedulingPills tally={tally} truncated={overview.truncated} now={now} canGo={canGo} activePill={activePill} onSelect={onPill} />

        {emptyWindow ? (
          // STATE: NO ENTRY IN THE WINDOW. The head says so beside the window switch; here the same fact with the next step,
          // a wider window, as the press. At ninety days there is no wider one, so it is a statement. Machine calls stands
          // under it: the list that carries that chip is not drawn here, and a window whose only entries are a machine's
          // would otherwise hold entries no press could show. What it says of machine calls is of the answer in hand, not of
          // the chip just pressed: until the read for the press lands, the answer is the one without them.
          <div className="flex min-w-0 flex-col gap-3">
            <EmptyState
              icon={CalendarSearchIcon}
              title={t('cerberus.scheduling.empty.title', { days })}
              message={t(overview.filters.machines === 1 ? 'cerberus.scheduling.empty.messageMachines' : 'cerberus.scheduling.empty.message')}
              actionLabel={wider === undefined ? undefined : t('cerberus.scheduling.empty.wider', { days: wider })}
              onAction={wider === undefined ? undefined : () => onWindow(wider)}
            />
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <MachineCallsChip selected={filters.machines} onToggle={() => onFilter({ ...filters, machines: !filters.machines })} />
              <span>{t('cerberus.scheduling.sessions.machinesTitle')}</span>
            </div>
          </div>
        ) : (
          // STATE: THE WINDOW HAS ENTRIES (or a filter narrowed it to none, which the Sessions list says under its own chips).
          <SchedulingBody overview={overview} read={read} filters={filters} now={now} onFilter={onFilter} onOpenEntry={onOpenEntry} />
        )}
      </div>

      {/* STATE: AN ENTRY IS OPEN. One sheet, portalled over the tab, and only while the view is shown: the tab keeps this view
          mounted when another shows, and a sheet left up would cover that one. The entry stays open and returns with the view. */}
      {shown && openId !== null && <EntrySheet summary={opened} sheet={sheet} now={now} onClose={onCloseEntry} onRetry={onRetry} />}
    </div>
  );
}
