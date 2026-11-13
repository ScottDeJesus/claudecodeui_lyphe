import { CalendarSearchIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import type { HealCard, HealItem } from '@/modules/heal';
import { LiveNow } from '@/modules/upload-runs/LiveNow';
import { RunSheet } from '@/modules/upload-runs/RunSheet';
// FILL: fake — this import leaves with the three uploads-fake*.ts files, which the fill deletes: the reads, the clock and the presses below take its place.
import { fakeScene, unwired } from '@/modules/upload-runs/uploads-fake';
import { UploadsBody } from '@/modules/upload-runs/UploadsBody';
import { UploadsHead } from '@/modules/upload-runs/UploadsHead';
import { UploadsPills } from '@/modules/upload-runs/UploadsPills';
import type { RunSheetRead, UploadsFilters, UploadsPillKey, UploadsRead, UploadsTally, UploadsWindow } from '@/modules/upload-runs/utils/uploadsModel';
import { agoWord } from '@/modules/upload-runs/utils/uploadsWords';
import { Banner, Button, EmptyState } from '@/shared/ui';

type UploadsViewProps = {
  /** Whether the Cerberus tab is showing this view. The tab keeps it mounted while hidden: hidden, it reads nothing and raises no sheet. */
  shown: boolean;
};

/** A block arriving: Verve's page entrance, as the Cerberus tab's own views enter. */
const ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

/** Where each pill carries the reader: the section its figure counted. Live now's is there only while a run is live. */
const PILL_TARGET: Record<UploadsPillKey, string> = {
  runs: 'uploads-runs',
  hiccups: 'uploads-types',
  live: 'uploads-live',
  lastRun: 'uploads-runs',
  healed: 'uploads-runs',
};

/**
 * THE UPLOADS VIEW: what happens when a person uses Restorly's Uploads page. Every press of Start upload that took the
 * slot is a RUN, and this view answers, for a window of days: how often and when the page is pressed, by whom, whether
 * each run went clean or hit a hiccup and why, what is running right now, and what tripped the agent and was healed.
 *
 * READ-ONLY. Cerberus watches; the Uploads page is where a person acts. There is no Start, no answer box and no Stop
 * here, on the view or in a run's sheet.
 *
 * IT STANDS UNDER THE TAB'S OWN HEADER, which carries the page's one big headline. So this view's head is a section's
 * heading, a size down, and never a second page title.
 *
 * Read top to bottom: the head (the answer in a headline, the summary, the window switch and Refresh); five pills, each
 * a press that carries the reader to its section; Live now, only while a run is going; the body (By upload type and How
 * often beside Runs); and one run's sheet over the tab when a row is pressed.
 *
 * The root is the view's data hub. It holds three things of its own (the window, the filters, the open run) and is
 * handed the rest as two reads, `UploadsRead` and `RunSheetRead` (`utils/uploadsModel.ts`); the parts draw what they are
 * given. It reads on show, on a press and when the feed says something moved, never on a timer and never while hidden
 * (MAN-8918). Words are `cerberus.uploads.*`; a login, a customer, a flow, a step and a reason's detail are data.
 *
 * Used by the cerberus module's `CerberusPanel`, through this module's barrel, as the sixth view of its strip.
 */
export function UploadsView({ shown }: UploadsViewProps) {
  const { t } = useTranslation();
  // FILL: fake — the scene the three initial values, the two reads and the clock below are taken from. With the fill the window starts at 30, the filters at none and no run is open.
  const scene = fakeScene();

  // The window on screen, in days. Held here so it survives a visit to another view of the tab, and so both reads follow one value.
  const [days, setDays] = useState<UploadsWindow>(scene.days);
  // What the Runs list is narrowed to. Held at the root, not in the list: three of the four are asked of the server, so the read needs them.
  const [filters, setFilters] = useState<UploadsFilters>(scene.filters);
  // The run the sheet is open on, by session id; null while it is closed. Held beside the reads, since it names what the sheet's read asks for and comes back with the view.
  const [openSid, setOpenSid] = useState<string | null>(scene.openSid);
  // The pill last pressed, whose section the reader was carried to; null until one is, so no pill reads as a filter in force.
  const [activePill, setActivePill] = useState<UploadsPillKey | null>(null);

  // ── The reads: on show, on a press and on a feed frame; never on a timer, never while hidden. ──
  // FILL: useUploadsRead — useUploadsRead(shown, days, filters): UploadsRead. On every show: the overview, then the heal answer for its runs' Claude session ids (200 a read). While shown: the feed open, any frame (coalesced over one second) re-reads both, every (re)open of the feed re-reads the overview, and a change in the heal context's heals re-reads the heal answer. A failed read after a good one keeps `overview` and sets `stale`. Hidden: the feed closed, nothing read.
  const read: UploadsRead = scene.read;
  // FILL: useLiveRun — useLiveRun(shown ? read.overview?.live?.session_id ?? null : null): LiveStep | null. The live run's own stream, read for its newest step, its turns and tool calls, and the walk step of the feed's newest walk frame for it. Its answer is what `read.live` holds: `useUploadsRead` composes it, so the root reads it once.
  // FILL: useRunSheet — useRunSheet(shown ? openSid : null): RunSheetRead. The run and its newest 500 events (the pane opens at its foot; Show earlier reads the 500 before the first one on screen, never from seq 0, which would open on the run's oldest page); on a live run its stream from the last seq read plus one; a `session_ended` event or a walk frame for this run re-reads the run; the heal answer for its one Claude session. Closing the sheet or hiding the view closes the stream.
  const sheet: RunSheetRead = scene.sheet;
  // FILL: now — the clock every age and the live run's elapsed time are counted from, epoch ms: one tick a second only while a run is live and the view is shown, and a fresh reading at each read otherwise.
  const now: number = scene.now;

  // ── The pure fills, each a function of an answer in hand; `useUploadsRead` hands their results over inside `read`. ──
  // FILL: joinFriction — joinFriction(answer: HealSessionsAnswer): Map<claude session id, RunFriction>. Per session: its rows that are not ignored, how many a landed heal took (`claimed_by` names a heal whose status is done), how many stand open. Feeds `read.friction`, and `read.healed` (the heals of the answer, landed and running).
  // FILL: typeRegression — typeRegression(answer, runs): Record<'initial' | 'final', boolean>. True for a type when one of its runs' sessions holds an item whose `regression` is not null. Feeds `read.regression`.
  // FILL: bucketDays — bucketDays(runs, days, now): DayBucket[]. One bucket per local day of the window, oldest first, the last one today; a dry run counts as `test`, a live run in none. Feeds `read.days`.
  // FILL: bucketHours — bucketHours(runs): number[24]. Presses by the local hour of `started_at`. Feeds `read.hours`.

  // ── The presses. None writes: they change what is read and what is shown. ──
  // FILL: onWindow — the window switch: setDays(next), which re-reads the overview.
  const onWindow: (next: UploadsWindow) => void = unwired(setDays);
  // FILL: onRefresh — Refresh: re-reads the overview and the heal answer, keeping the screen as it is until the new answer lands.
  const onRefresh: () => void = unwired();
  // FILL: onFilter — a filter chip: setFilters(next). A change of `by`, `tests` or `account` re-reads the overview; `hiccupsOnly` alone re-reads nothing.
  const onFilter: (next: UploadsFilters) => void = unwired(setFilters);
  // FILL: onOpenRun — a run's row, a type's row of runs, or Live now's Open: setOpenSid(sessionId).
  const onOpenRun: (sessionId: string) => void = unwired(setOpenSid);
  // FILL: onCloseRun — the sheet's Escape, its ✕ and its scrim: setOpenSid(null).
  const onCloseRun: () => void = unwired(setOpenSid);
  // FILL: onShowEarlier — the sheet's Show earlier: reads the page of events before the oldest on screen and puts it above them.
  const onShowEarlier: () => void = unwired();
  // FILL: onRetry — Try again, on the view's banner, its stale strip, the sheet's banner and the two "heal ledger could not be read" banners (the Runs list's and the sheet's): re-reads what failed.
  const onRetry: () => void = unwired();
  // FILL: onPill — a pill: setActivePill(key), then the section `PILL_TARGET[key]` scrolled into view (`scrollIntoView`, instant under prefers-reduced-motion), as the heal panel carries its reader (`heal/HealPanel.tsx` :73).
  const onPill: (key: UploadsPillKey) => void = unwired(setActivePill, PILL_TARGET);
  // FILL: onOpenFriction — a friction row's transcript press: `useOpenFrictionLine()` from the heal barrel.
  const onOpenFriction: (item: HealItem) => void = unwired();
  // FILL: onOpenBrief — a heal card's Open brief: `useOpenHealBrief()` from the heal barrel.
  const onOpenBrief: (heal: HealCard) => void = unwired();

  const overview = read.overview;

  if (overview === null) {
    return (
      <div className="flex min-w-0 max-w-[1180px] flex-col gap-5 px-[clamp(16px,4cqi,32px)] pb-7 pt-5" data-uploads-view={read.phase}>
        <p className="text-xs uppercase tracking-[0.14em] text-muted-foreground">{t('cerberus.uploads.head.eyebrow')}</p>
        {read.phase === 'trouble' ? (
          // STATE: THE FIRST READ FAILED. There is no answer to show, so the view is its own banner: the lane's sentence and
          // Try again. Warn, not danger: nothing was refused, the engine did not answer, and the next read may.
          <div role="alert" className={`max-w-xl ${ENTER}`}>
            <TroubleBanner title={t('cerberus.uploads.trouble.title')} detail={read.trouble} retry={t('cerberus.uploads.trouble.retry')} onRetry={onRetry} />
          </div>
        ) : (
          // STATE: THE FIRST READ IS OUT. Held back 150 ms, so a fast read never flashes it; then the view's own shape in
          // shimmering blocks (a headline, the pills, the two columns' rows), so nothing jumps when the answer lands.
          <div role="status" aria-busy="true" aria-label={t('cerberus.uploads.loading')} className="flex animate-[vv-fade_200ms_ease_150ms_both] flex-col gap-5 [container-type:inline-size]">
            <div className="vv-skeleton h-9 w-72 max-w-full" />
            <div className="vv-skeleton h-11" />
            <div className="grid gap-x-8 gap-y-3 [@container(min-width:48rem)]:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
              <div className="flex flex-col gap-2">{[0, 1, 2].map((row) => <div key={row} className="vv-skeleton h-11" />)}</div>
              <div className="flex flex-col gap-2">{[0, 1, 2, 3, 4].map((row) => <div key={row} className="vv-skeleton h-[68px]" />)}</div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // The window's armed runs, counted for the head and the pills: a test run is in none of these, and the last run is the newest that is not still going.
  const armed = overview.runs.filter((run) => !run.dry_run);
  const tally: UploadsTally = {
    runs: armed.length,
    clean: armed.filter((run) => run.verdict === 'clean').length,
    hiccups: armed.filter((run) => run.verdict === 'hiccup').length,
    last: armed.find((run) => run.verdict !== 'live') ?? null,
  };
  const liveRun = overview.live;
  const liveState = liveRun === null ? null : (read.live === null ? liveRun.state !== 'awaiting_input' : read.live.working) ? 'working' : 'waiting';
  // The window holds no run at all, and no person or account was asked for: an empty window, not a filter that matched nothing.
  const emptyWindow = overview.runs.length === 0 && filters.by === null && filters.account === null;
  // Whether each pill has somewhere to carry the reader: none of them over an empty window (it has no section), and Live now's only while a run is live.
  const canGo: Record<UploadsPillKey, boolean> = { runs: !emptyWindow, hiccups: !emptyWindow, live: liveRun !== null, lastRun: !emptyWindow, healed: !emptyWindow };
  const wider = ([30, 90] as UploadsWindow[]).find((length) => length > days);
  // The open run as the overview lists it, so the sheet's head stands before the run's own read answers.
  const opened = openSid === null ? null : overview.runs.find((run) => run.session_id === openSid) ?? (liveRun?.session_id === openSid ? liveRun : null);

  return (
    // The view is its own size container: the body's two columns follow the view's width, never the window's.
    <div className="min-w-0 max-w-[1180px] px-[clamp(16px,4cqi,32px)] pb-7 pt-5" data-uploads-view={read.stale ? 'stale' : 'ready'}>
      <div className={`flex min-w-0 flex-col gap-5 [container-type:inline-size] ${ENTER}`}>
        <UploadsHead days={days} tally={tally} live={liveState} truncated={overview.truncated} filters={filters} now={now} onWindow={onWindow} onRefresh={onRefresh} onFilter={onFilter} />

        {read.stale && (
          // STATE: A READ FAILED AFTER A GOOD ONE. The last answer stays on screen, and this strip says it is the last answer,
          // not this minute's, and HOW OLD it is: a monitor that cannot see must never look current, and the age is what
          // tells a reader whether what is under the strip is still worth reading.
          <div role="alert">
            <TroubleBanner title={t('cerberus.uploads.trouble.stale', { ago: agoWord(t, overview.generated_at, now) })} detail={read.trouble} retry={t('cerberus.uploads.trouble.retry')} onRetry={onRetry} />
          </div>
        )}

        <UploadsPills tally={tally} truncated={overview.truncated} live={liveState} healed={read.healed} frictionFailed={read.frictionFailed} now={now} canGo={canGo} activePill={activePill} onSelect={onPill} />

        {/* STATE: A RUN IS LIVE. Drawn only while the registry holds one: with none, nothing stands in its place. */}
        {liveRun !== null && <LiveNow run={liveRun} step={read.live} now={now} onOpenRun={onOpenRun} />}

        {emptyWindow ? (
          // STATE: NO RUN IN THE WINDOW. The head says so beside the window switch; here the same fact with the next step,
          // a wider window, as the press. At ninety days there is no wider one, so it is a statement.
          <EmptyState
            icon={CalendarSearchIcon}
            title={t('cerberus.uploads.empty.title', { days })}
            message={t(filters.tests ? 'cerberus.uploads.empty.messageTests' : 'cerberus.uploads.empty.message')}
            actionLabel={wider === undefined ? undefined : t('cerberus.uploads.empty.wider', { days: wider })}
            onAction={wider === undefined ? undefined : () => onWindow(wider)}
          />
        ) : (
          // STATE: THE WINDOW HAS RUNS (or a filter narrowed it to none, which the Runs list says under its own chips).
          <UploadsBody overview={overview} read={read} filters={filters} now={now} onFilter={onFilter} onOpenRun={onOpenRun} onRetry={onRetry} />
        )}
      </div>

      {/* STATE: A RUN IS OPEN. One sheet, portalled over the tab, and only while the view is shown: the tab keeps this view
          mounted when another shows, and a sheet left up would cover that one. The run stays open and returns with the view. */}
      {shown && openSid !== null && (
        <RunSheet
          summary={opened}
          sheet={sheet}
          walkStep={liveRun?.session_id === openSid ? read.live?.walkStep ?? null : null}
          now={now}
          onClose={onCloseRun}
          onShowEarlier={onShowEarlier}
          onRetry={onRetry}
          onOpenFriction={onOpenFriction}
          onOpenBrief={onOpenBrief}
        />
      )}
    </div>
  );
}

/** The lane's fault as the view says it: what cannot be read, the lane's own sentence under it, and Try again (44 px under a finger). */
function TroubleBanner({ title, detail, retry, onRetry }: { title: string; detail: string | null; retry: string; onRetry: () => void }) {
  return (
    <Banner
      tone="warn"
      action={<Button variant="tonal" size="sm" className="h-8 flex-none px-2.5 text-xs max-md:h-11" onClick={onRetry}>{retry}</Button>}
    >
      <p className="text-sm font-medium">{title}</p>
      {detail !== null && <p className="mt-0.5 text-xs">{detail}</p>}
    </Banner>
  );
}
