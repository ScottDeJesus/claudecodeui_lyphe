import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AffectedAreasView } from '@/modules/affected-areas';
import { BulletinsView } from '@/modules/carrier-bulletins';
import { CatalogView } from '@/modules/cerberus/catalog/CatalogView';
import { CerberusHeader } from '@/modules/cerberus/CerberusHeader';
import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { ProjectChoicesContext } from '@/modules/cerberus/context/ProjectChoicesContext';
import { FleetView } from '@/modules/cerberus/fleet/FleetView';
import { HistoryView } from '@/modules/cerberus/history/HistoryView';
import { useKeptViews } from '@/modules/cerberus/hooks/useKeptViews';
import { KeptView } from '@/modules/cerberus/KeptView';
import { EnrollDialog } from '@/modules/cerberus/modals/EnrollDialog';
import { MuteDialog } from '@/modules/cerberus/modals/MuteDialog';
import { PromoteDialog } from '@/modules/cerberus/modals/PromoteDialog';
import { UpdateWardensDialog } from '@/modules/cerberus/modals/UpdateWardensDialog';
import { CheckSheet } from '@/modules/cerberus/sheet/CheckSheet';
import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import type { CerberusCheckView, CerberusDiagnosisView } from '@/shared/cerberus-types';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { CerberusSheetTarget, CerberusView, ProjectChoice } from '@/shared/types';
import { ScrollArea, Tabs } from '@/shared/ui';
import { cn, resizeObserverIn } from '@/shared/utils';

type CerberusPanelProps = {
  /**
   * The projects in the workspace's sidebar, which "Run a project here" offers (those on no node). The
   * workspace draws its loading state until its first read of them has answered, so a panel is only ever
   * mounted with a list that was read.
   */
  projectChoices: ProjectChoice[];
};

/** The panel's own width below which it draws narrow. */
const NARROW_BELOW_PX = 620;

/** The width it must rise above to draw wide again: 40 px past the line it fell under, so a panel dragged to the edge never flickers. */
const WIDE_ABOVE_PX = 660;

/** The tab's views in the strip's order, each with its name and the hint beside the strip. */
const VIEWS: readonly { id: CerberusView; labelKey: string; hintKey: string }[] = [
  { id: 'fleet', labelKey: 'cerberus.fleet.tabs.fleet', hintKey: 'cerberus.fleet.tabs.fleetHint' },
  { id: 'catalog', labelKey: 'cerberus.catalog.tab', hintKey: 'cerberus.catalog.tabHint' },
  { id: 'history', labelKey: 'cerberus.fleet.tabs.history', hintKey: 'cerberus.fleet.tabs.historyHint' },
  { id: 'tours', labelKey: 'cerberus.tours.tab', hintKey: 'cerberus.tours.tabHint' },
  { id: 'bulletins', labelKey: 'cerberus.bulletins.tab', hintKey: 'cerberus.bulletins.tabHint' },
];

/** A view arriving: Verve's page entrance at the prototype's .45 s. It plays again each time a view is shown. */
const VIEW_ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

/** The gutter every block of the tab keeps, from the panel's own width (`cqi`), as the prototype's do. */
const GUTTER = 'px-[clamp(16px,4cqi,32px)]';

/**
 * THE CERBERUS TAB: the answer at the top, the views under it, and the sheet and the dialogs over them
 * (`design/cerberus/Cerberus Tab.dc.html` :32-57).
 *
 * Read top to bottom:
 * 1. `CerberusHeader`: the headline, the summary, the clock pill, the update button and Enroll a node.
 * 2. Only while the fleet on screen is stale: "Cerberus can't be reached · Showing the last answer it
 *    gave." with Try again.
 * 3. The strip, Fleet · Catalog · History · Tours · Bulletins, with a hint beside it saying how the view shown is read.
 * 4. The view shown.
 *
 * WHILE THERE IS NO FLEET, TWO STATES. Until the first read answers: "Loading Cerberus…", held back
 * 150 ms so a fast read never flashes it. When that read failed: "Cerberus can't be reached" with Try
 * again, the tab's one spelling of the state.
 *
 * A FLEET THAT HAS GONE STALE SAYS SO. A read that fails after a good one keeps the fleet on screen (the
 * provider's rule). Once no read has answered for 90 s, the banner stands between the header and the
 * strip, and the header's pill stops saying Live. A monitor that cannot see must never look green.
 *
 * TRY AGAIN SPEAKS AGAIN. Both banners are keyed by Try again's finished reads, so a retry that fails
 * again mounts the banner afresh: it enters again, and its alert is heard again. A read the provider
 * makes on its own never re-keys it, so a fleet that stays out of reach is not announced every 30 s.
 *
 * NARROW IS THE PANEL'S OWN WIDTH, never the window's: the root is a size container, and every block's
 * gutter follows it. The narrow flag has the prototype's hysteresis (narrow below 620 px, wide again only
 * above 660 px), so a panel dragged to the edge never flickers between the two. Fleet reads it.
 *
 * FLEET STAYS MOUNTED WHILE ANOTHER VIEW SHOWS. Its layout, filter, search and open nodes are the person's
 * place in the fleet, and they come back as they were left, as the prototype keeps them. Fleet reads
 * nothing of its own, so hidden it costs nothing. Catalog holds no place of its own, and History reads its
 * index, its feed and a check every 30 s, so each is mounted only while it shows. A view shown again plays
 * its entrance again. Tours and Bulletins are kept mounted for the same reason (`KeptView`): each mounts on its first
 * show and is `hidden` after, so the tour, pano and face, or the carrier and page, and the scroll a person left survive a
 * visit to Fleet. Each reads on open and on a press and never on a timer or while hidden (`src/modules/affected-areas`,
 * `src/modules/carrier-bulletins`), so kept mounted it costs nothing.
 *
 * THE PROJECTS A NODE CAN TAKE come in as a prop and reach the Fleet view through `ProjectChoicesContext`:
 * the workspace owns that list and imports this module, so the panel is handed it, never reads it.
 *
 * THE HOSTS. One check sheet, opened from a Fleet minute, a service row or a Needs-you card. One Mute
 * dialog, opened from a Needs-you card or the sheet; it opens in front of the sheet, which waits beneath
 * it. One Promote dialog, opened from the sheet's diagnosis (Add to catalog), in front of the sheet as Mute's is;
 * a promotion that lands closes both and shows the Catalog. One Enroll dialog and one Update wardens dialog, opened from the header; closing the second never stops the batch it started. Each is mounted only while it is open.
 *
 * For src/modules/project-workspace's `WorkspaceMain`, which draws it as the Cerberus tab, through this
 * module's barrel.
 */
export function CerberusPanel({ projectChoices }: CerberusPanelProps) {
  const { t } = useTranslation();
  // The element the container query measures: the panel's own box.
  const rootRef = useRef<HTMLDivElement>(null);
  const hostWindow = useHostWindow();

  // The fleet the provider keeps, null until a read answers; whether that first read failed; and whether
  // what is held is the last answer rather than this minute's (the provider judges it at each failed read).
  const { overview, unreachable, stale, refresh, wardens } = useCerberus();

  // How many of Try again's reads have finished. Essential, not derivable: both banners are keyed by it, so
  // a retry that fails again mounts the banner afresh and its alert is heard again, while the provider's
  // own 30 s reads never touch it.
  const [attempt, setAttempt] = useState(0);
  // Whether the panel draws narrow, as the hysteresis below last decided it. State rather than a pure
  // function of the width: between 620 and 660 px the answer depends on which side the panel came from.
  const [narrow, setNarrow] = useState(false);
  // The view the strip shows: the person's place among the tab's views, kept for as long as the tab stands.
  const [view, setView] = useState<CerberusView>('fleet');
  // The panel's scroller (the box inside `ScrollArea`), whose offset the kept views (Tours, Bulletins) keep through a visit to another view.
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Which views have been shown, and the offset a kept view is left at (`leaving`), so each comes back where it was.
  const { shownOnce, leaving } = useKeptViews(view, scrollerRef);
  // The check the sheet is open on and the moment its lookup opens at (a Fleet cell's own minute, or now
  // for a service row and a Needs-you card); null while the sheet is closed.
  const [sheet, setSheet] = useState<CerberusSheetTarget | null>(null);
  // The check the Mute dialog is open on; null while it is closed. Held beside the sheet, never in it,
  // since a Needs-you card mutes with no sheet open and the sheet stays open under the dialog.
  const [muting, setMuting] = useState<CerberusCheckView | null>(null);
  // The diagnosis the Promote dialog is open on, with the check it diagnosed; null while it is closed. Held beside the
  // sheet, as Mute's is, since the dialog opens in front of the sheet and the sheet stays open under it.
  const [promoting, setPromoting] = useState<{ diagnosis: CerberusDiagnosisView; check: CerberusCheckView } | null>(null);
  // Whether the Enroll dialog is open: the one dialog with no subject, so a flag is all it needs.
  const [enrolling, setEnrolling] = useState(false);
  // Whether the Update wardens dialog is open. A flag, as Enroll's: the batch it follows is its own, and a
  // dialog closed over a running batch leaves the batch going, so nothing here has to outlive the dialog.
  const [updatingWardens, setUpdatingWardens] = useState(false);

  // The narrow flag follows the panel's own width, never the window's. A width of 0 (the tab hidden)
  // changes nothing, so the layout a person left comes back as it was.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const observer = resizeObserverIn(hostWindow, (entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width === 0) return;
      setNarrow((wasNarrow) => (wasNarrow ? width <= WIDE_ABOVE_PX : width < NARROW_BELOW_PX));
    });
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [hostWindow]);

  // Try again reads the overview once more. An answer takes the banner away; a read that fails again
  // mounts it afresh. `refresh` never rejects, so the count of finished reads always moves.
  const onRetry = () => {
    void refresh().then(() => setAttempt((finished) => finished + 1));
  };
  const onView = (next: CerberusView) => {
    leaving(next);
    setView(next);
  };
  const onOpenSheet = (target: CerberusSheetTarget) => setSheet(target);
  const onCloseSheet = () => setSheet(null);
  // The sheet stays open under the Mute dialog: the dialog opens in front of it.
  const onMute = (check: CerberusCheckView) => setMuting(check);
  const onCloseMute = () => setMuting(null);
  const onPromote = (diagnosis: CerberusDiagnosisView, check: CerberusCheckView) => setPromoting({ diagnosis, check });
  const onClosePromote = () => setPromoting(null);
  // A promotion landed: the dialog and the sheet behind it go, and the Catalog shows the new entry, newest first with its "New" wash.
  const onPromoted = () => {
    setPromoting(null);
    setSheet(null);
    setView('catalog');
  };
  const onEnroll = () => setEnrolling(true);
  const onCloseEnroll = () => setEnrolling(false);
  const onUpdateWardens = () => setUpdatingWardens(true);
  const onCloseUpdateWardens = () => setUpdatingWardens(false);

  const shown = VIEWS.find((entry) => entry.id === view) ?? VIEWS[0];

  return (
    <div
      ref={rootRef}
      data-cerberus-panel={narrow ? 'narrow' : 'wide'}
      className="flex h-full flex-col bg-background text-foreground [container-type:inline-size]"
    >
      <ScrollArea ref={scrollerRef} className="min-h-0 flex-1">
        {overview === null ? (
          unreachable ? (
            <div key={attempt} className={cn('max-w-xl pt-[clamp(20px,5cqi,28px)]', GUTTER, VIEW_ENTER)}>
              <UnreachableBanner onRetry={onRetry} />
            </div>
          ) : (
            <p role="status" className={cn('animate-[vv-fade_200ms_ease_150ms_both] py-7 text-[13.5px] text-muted-foreground', GUTTER)}>
              {t('cerberus.loading')}
            </p>
          )
        ) : (
          <>
            <CerberusHeader overview={overview} stale={stale} wardens={wardens} onEnroll={onEnroll} onUpdateWardens={onUpdateWardens} />
            {stale && (
              // The fleet below is the last answer center gave, not this minute's. Full width, as every block
              // under the header is.
              <div key={attempt} className={cn('pt-5', GUTTER, VIEW_ENTER)}>
                <UnreachableBanner onRetry={onRetry} detail={t('cerberus.errors.lastAnswer')} />
              </div>
            )}
            <div className={cn('flex flex-wrap items-center justify-between gap-3 pt-5', GUTTER)}>
              <Tabs
                tabs={VIEWS.map((entry) => ({ id: entry.id, label: t(entry.labelKey) }))}
                active={view}
                onChange={(id) => {
                  const next = VIEWS.find((entry) => entry.id === id);
                  if (next) onView(next.id);
                }}
                ariaLabel={t('tabs.cerberus')}
              />
              <p className="text-[12.5px] text-muted-foreground">{t(shown.hintKey)}</p>
            </div>

            {/* `hidden` rather than unmounted, so Fleet keeps its place; nothing on its wrapper sets a display. */}
            <div role="tabpanel" aria-label={t('cerberus.fleet.tabs.fleet')} hidden={view !== 'fleet'} className={VIEW_ENTER}>
              <ProjectChoicesContext.Provider value={projectChoices}>
                <FleetView overview={overview} narrow={narrow} onOpenCell={onOpenSheet} onMute={onMute} />
              </ProjectChoicesContext.Provider>
            </div>
            {view === 'catalog' && (
              <div role="tabpanel" aria-label={t('cerberus.catalog.tab')} className={VIEW_ENTER}>
                <CatalogView />
              </div>
            )}
            {view === 'history' && (
              <div role="tabpanel" aria-label={t('cerberus.fleet.tabs.history')} className={VIEW_ENTER}>
                <HistoryView />
              </div>
            )}
            {/* Tours and Bulletins are `hidden` once left rather than unmounted, as Fleet is, and for the same reason: the
                open tour, pano and face, or the open carrier and page, and the scroll are the person's place (MAN-7891).
                Each reads on open and on a press, never while hidden. Each is its own chunk, loaded on its first show. */}
            <KeptView id="tours" view={view} shownOnce={shownOnce} label={t('cerberus.tours.tab')}>
              <AffectedAreasView />
            </KeptView>
            <KeptView id="bulletins" view={view} shownOnce={shownOnce} label={t('cerberus.bulletins.tab')}>
              <BulletinsView />
            </KeptView>
          </>
        )}
      </ScrollArea>

      {/* The hosts, each portalled over the tab while it is open. The Mute dialog opened from the sheet lands
          in front of it, and the sheet stands down for it on Escape (`overlayEscape.ts`). */}
      {sheet !== null && (
        <CheckSheet
          open
          onClose={onCloseSheet}
          node={sheet.node}
          service={sheet.service}
          check={sheet.check}
          lookupAt={sheet.lookupAt}
          run={sheet.run}
          onMute={onMute}
          onPromote={onPromote}
        />
      )}
      <MuteDialog open={muting !== null} check={muting} onClose={onCloseMute} />
      <PromoteDialog
        open={promoting !== null}
        diagnosis={promoting?.diagnosis ?? null}
        check={promoting?.check ?? null}
        onClose={onClosePromote}
        onPromoted={onPromoted}
      />
      <EnrollDialog open={enrolling} onClose={onCloseEnroll} />
      <UpdateWardensDialog open={updatingWardens} onClose={onCloseUpdateWardens} />
    </div>
  );
}
