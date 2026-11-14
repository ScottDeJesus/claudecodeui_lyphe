import { CalendarSearchIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useOpenFrictionLine, useOpenHealBrief } from '@/modules/heal';
import { useRunSheet } from '@/modules/upload-runs/hooks/useRunSheet';
import { useUploadsClock } from '@/modules/upload-runs/hooks/useUploadsClock';
import { useUploadsRead } from '@/modules/upload-runs/hooks/useUploadsRead';
import { LiveNow } from '@/modules/upload-runs/LiveNow';
import { RunSheet } from '@/modules/upload-runs/RunSheet';
import { TestRunsChip } from '@/modules/upload-runs/TestRunsChip';
import { UploadsBody } from '@/modules/upload-runs/UploadsBody';
import { UploadsHead } from '@/modules/upload-runs/UploadsHead';
import { UploadsPills } from '@/modules/upload-runs/UploadsPills';
import type { LiveStatus, UploadsFilters, UploadsPillKey, UploadsTally, UploadsWindow } from '@/modules/upload-runs/utils/uploadsModel';
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

  // The window on screen, in days. Held here so it survives a visit to another view of the tab, and so both reads follow one value.
  const [days, setDays] = useState<UploadsWindow>(30);
  // What the Runs list is narrowed to. Held at the root, not in the list: three of the four are asked of the server, so the read needs them.
  const [filters, setFilters] = useState<UploadsFilters>({ by: null, tests: false, hiccupsOnly: false, account: null });
  // The run the sheet is open on, by session id; null while it is closed. Held beside the reads, since it names what the sheet's read asks for and comes back with the view.
  const [openSid, setOpenSid] = useState<string | null>(null);
  // The pill last pressed, whose section the reader was carried to; null until one is, so no pill reads as a filter in force.
  const [activePill, setActivePill] = useState<UploadsPillKey | null>(null);
  // The view's own element, where keyboard focus is looked for again, and whether Test runs was pressed and its answer has not landed.
  const root = useRef<HTMLDivElement>(null);
  const testsPressed = useRef(false);

  // ── The reads: on show, on a press and on a feed frame; never on a timer, never while hidden. ──
  // The window's runs, the feed they are told by, the heal answer joined to them and the live run's newest step.
  const { read, feed, readAt, refresh, retry } = useUploadsRead({ shown, window: days, filters });
  // The open run and its events; the sheet is drawn only while the view is shown, so a hidden view has its stream closed.
  const { sheet, showEarlier, retry: retrySheet } = useRunSheet(shown ? openSid : null, feed);
  // The clock every age and the live run's elapsed time are counted from: read afresh at every show and at every settled read (failures too, so the stale strip's age is true), and ticking only while a run is live.
  const now = useUploadsClock(shown, read.overview !== null && read.overview.live !== null, readAt);

  // ── The presses. None writes: they change what is read and what is shown. ──
  // The window and the filters are part of the overview's key, so changing them reads it again; Hiccups only alone is the browser's own and reads nothing.
  const onWindow = setDays;
  const onFilter = (next: UploadsFilters) => {
    // Test runs is the one filter that moves a control: the answer decides whether the chip stands under the empty state or among the Runs list's chips.
    if (next.tests !== filters.tests) testsPressed.current = true;
    setFilters(next);
  };
  const onRefresh = refresh;
  const onOpenRun = setOpenSid;
  const onCloseRun = () => setOpenSid(null);
  const onShowEarlier = showEarlier;
  const onRetry = () => {
    retry();
    retrySheet();
  };
  // A pill carries the reader to its section, as the heal panel carries its reader: instant for a reader who asked for less motion.
  const onPill = (key: UploadsPillKey) => {
    setActivePill(key);
    document.getElementById(PILL_TARGET[key])?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
      block: 'start',
    });
  };
  // The workspace's own openers: a friction row's transcript line, and a heal's brief.
  const onOpenFriction = useOpenFrictionLine();
  const onOpenBrief = useOpenHealBrief();

  const overview = read.overview;

  // The answer to a press on Test runs landed (or the view was hidden before it did): the chip may have moved, and the button
  // that was pressed went with its old home, which drops keyboard focus to the page. Focus follows the chip to its new place.
  useEffect(() => {
    if (!testsPressed.current) return;
    testsPressed.current = false;
    if (shown && document.activeElement === document.body) root.current?.querySelector<HTMLElement>('[data-uploads-tests-chip] button')?.focus();
  }, [overview, shown]);

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
  const liveStatus: LiveStatus | null = liveRun === null
    ? null
    : { state: (read.live === null ? liveRun.state !== 'awaiting_input' : read.live.working) ? 'working' : 'waiting', test: liveRun.dry_run };
  // The window holds no run at all, and no person or account was asked for: an empty window, not a filter that matched nothing.
  const emptyWindow = overview.runs.length === 0 && filters.by === null && filters.account === null;
  // Whether each pill has somewhere to carry the reader: none of them over an empty window (it has no section), and Live now's only while a run is live.
  const canGo: Record<UploadsPillKey, boolean> = { runs: !emptyWindow, hiccups: !emptyWindow, live: liveRun !== null, lastRun: !emptyWindow, healed: !emptyWindow };
  const wider = ([30, 90] as UploadsWindow[]).find((length) => length > days);
  // The open run as the overview lists it, so the sheet's head stands before the run's own read answers.
  const opened = openSid === null ? null : overview.runs.find((run) => run.session_id === openSid) ?? (liveRun?.session_id === openSid ? liveRun : null);

  return (
    // The view is its own size container: the body's two columns follow the view's width, never the window's.
    <div ref={root} className="min-w-0 max-w-[1180px] px-[clamp(16px,4cqi,32px)] pb-7 pt-5" data-uploads-view={read.stale ? 'stale' : 'ready'}>
      <div className={`flex min-w-0 flex-col gap-5 [container-type:inline-size] ${ENTER}`}>
        <UploadsHead days={days} tally={tally} live={liveStatus} truncated={overview.truncated} filters={filters} now={now} onWindow={onWindow} onRefresh={onRefresh} onFilter={onFilter} />

        {read.stale && (
          // STATE: A READ FAILED AFTER A GOOD ONE. The last answer stays on screen, and this strip says it is the last answer,
          // not this minute's, and HOW OLD it is: a monitor that cannot see must never look current, and the age is what
          // tells a reader whether what is under the strip is still worth reading.
          <div role="alert">
            <TroubleBanner title={t('cerberus.uploads.trouble.stale', { ago: agoWord(t, overview.generated_at, now) })} detail={read.trouble} retry={t('cerberus.uploads.trouble.retry')} onRetry={onRetry} />
          </div>
        )}

        <UploadsPills tally={tally} truncated={overview.truncated} live={liveStatus} healed={read.healed} frictionFailed={read.frictionFailed} now={now} canGo={canGo} activePill={activePill} onSelect={onPill} />

        {/* STATE: A RUN IS LIVE. Drawn only while the registry holds one: with none, nothing stands in its place. */}
        {liveRun !== null && <LiveNow run={liveRun} step={read.live} now={now} onOpenRun={onOpenRun} />}

        {emptyWindow ? (
          // STATE: NO RUN IN THE WINDOW. The head says so beside the window switch; here the same fact with the next step,
          // a wider window, as the press. At ninety days there is no wider one, so it is a statement. Test runs stands
          // under it: the list that carries that chip is not drawn here, and a window whose only runs are dry ones
          // (a new account's first) would otherwise hold runs no press could show. What it says of test runs is of the answer
          // in hand, not of the chip just pressed: until the read for the press lands, the answer is the one without them.
          <div className="flex min-w-0 flex-col gap-3">
            <EmptyState
              icon={CalendarSearchIcon}
              title={t('cerberus.uploads.empty.title', { days })}
              message={t(overview.filters.tests ? 'cerberus.uploads.empty.messageTests' : 'cerberus.uploads.empty.message')}
              actionLabel={wider === undefined ? undefined : t('cerberus.uploads.empty.wider', { days: wider })}
              onAction={wider === undefined ? undefined : () => onWindow(wider)}
            />
            <div className="flex min-w-0 flex-wrap items-center justify-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
              <TestRunsChip selected={filters.tests} onToggle={() => onFilter({ ...filters, tests: !filters.tests })} />
              <span>{t('cerberus.uploads.runs.testsTitle')}</span>
            </div>
          </div>
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
