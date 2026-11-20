import '@/modules/cerberus/cerberusScreen.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AffectedAreasView } from '@/modules/affected-areas';
import { BulletinsView } from '@/modules/carrier-bulletins';
import { CatalogView } from '@/modules/cerberus/catalog/CatalogView';
import { CerberusFoot } from '@/modules/cerberus/CerberusFoot';
import { CerberusInstrument } from '@/modules/cerberus/CerberusInstrument';
import { useCerberus } from '@/modules/cerberus/context/CerberusContext';
import { ProjectChoicesContext } from '@/modules/cerberus/context/ProjectChoicesContext';
import { fleetItems, groupOf } from '@/modules/cerberus/fleet/fleetModel';
import { FleetOpening } from '@/modules/cerberus/fleet/FleetOpening';
import { NodeOpening } from '@/modules/cerberus/fleet/NodeOpening';
import { HistoryView } from '@/modules/cerberus/history/HistoryView';
import { useKeptViews } from '@/modules/cerberus/hooks/useKeptViews';
import { KeptView } from '@/modules/cerberus/KeptView';
import { EnrollDialog } from '@/modules/cerberus/modals/EnrollDialog';
import { MuteDialog } from '@/modules/cerberus/modals/MuteDialog';
import { PromoteDialog } from '@/modules/cerberus/modals/PromoteDialog';
import { UpdateWardensDialog } from '@/modules/cerberus/modals/UpdateWardensDialog';
import { CheckSheet } from '@/modules/cerberus/sheet/CheckSheet';
import { UnreachableBanner } from '@/modules/cerberus/UnreachableBanner';
import { markLook, nodeMark } from '@/modules/cerberus/utils/cerberusStatus';
import { fleetHeadline } from '@/modules/cerberus/utils/fleetWords';
import { fleetRings, machineWord, moreMarkId, ringLabel, ringOfMoreMark } from '@/modules/cerberus/utils/fleetRings';
import type { FleetRingId } from '@/modules/cerberus/utils/fleetRings';
import { SchedulingView } from '@/modules/scheduling-report';
import { UploadsView } from '@/modules/upload-runs';
import type { CerberusCheckView, CerberusDiagnosisView } from '@/shared/cerberus-types';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { AstrolabePoint, AstrolabeRingGauge, AstrolabeRingsHandle, CerberusSheetTarget, CerberusView, FleetDoing, ProjectChoice } from '@/shared/types';
import { Button, Opening, ScrollArea } from '@/shared/ui';
import { cn, resizeObserverIn } from '@/shared/utils';

type CerberusPanelProps = {
  /**
   * The projects in the workspace's sidebar, which "Run a project here" offers (those on no node). The
   * workspace draws its loading state until its first read of them has answered, so a panel is only ever
   * mounted with a list that was read.
   */
  projectChoices: ProjectChoice[];
};

/** The instrument's square at home, at most: the design system's home size. */
const INSTRUMENT_HOME = 720;

/** A face arriving: Verve's page entrance at the prototype's .45 s. It plays again each time a face is shown. */
const VIEW_ENTER = 'motion-safe:animate-[vv-pagein_.45s_theme(transitionTimingFunction.enter)_both]';

/** The gutter every block of a face keeps, from the panel's own width (`cqi`), as the prototype's do. */
const GUTTER = 'px-[clamp(16px,4cqi,32px)]';

/** What hangs from the core or a ring rather than from a machine: the fleet itself, or a ring's further machines. */
type OtherOpening = { kind: 'fleet' } | { kind: 'more'; ringId: FleetRingId };

/**
 * THE CERBERUS SCREEN: the fleet as an instrument, the other six faces behind the foot, and the sheet and the dialogs over them.
 *
 * THE FLEET IS THE INSTRUMENT (`CerberusInstrument`, `utils/fleetRings`): Cerberus's core in the middle of the scene and round it a
 * ring for each state a machine can be in, what needs you innermost, every machine a mark. The core's form is what the fleet is
 * doing (the listening dish while a check needs a person, writing toward a machine while a fix runs on it, thinking while a warden
 * updates), and its one measure is the share of checks passing; a press on the measure opens History. Nothing is written at rest.
 *
 * WHAT OPENS, hung from where it was pressed (the kit's `Opening`), one at a time:
 * - A machine's mark: the machine (`NodeOpening`): what needs you on it with its fix, its services and their last 30 minutes, what
 *   is muted on it, its warden and the projects that run there.
 * - The core: the fleet (`FleetOpening`), under its answer ("All quiet", "2 checks need you"): the summary, the live line, the
 *   wardens' update and Enroll a node, what is muted, and What happened.
 * - A ring's "more" mark, past its 23 marks: the rest of its machines, each a press that opens it.
 *
 * THE FOOT (`CerberusFoot`): the seven faces, Fleet · Catalog · History · Tours · Bulletins · Uploads · Scheduling, and on the fleet
 * the plus that enrolls a node. On any other face the face is the work, in its own scroller, and the instrument is docked at the
 * foot's start, still live; a press on it, or the Fleet face, brings the fleet back.
 *
 * WHILE THERE IS NO FLEET, TWO STATES. Until the first read answers: "Loading Cerberus…", held back 150 ms so a fast read never
 * flashes it. When that read failed: "Cerberus can't be reached" with Try again.
 *
 * A FLEET THAT HAS GONE STALE SAYS SO. A read that fails after a good one keeps the fleet on screen (the provider's rule). Once no
 * read has answered for 90 s, the banner stands over the scene, and the fleet's live line stops saying Live. A monitor that cannot
 * see must never look green. Both banners are keyed by Try again's finished reads, so a retry that fails again is heard again.
 *
 * TOURS, BULLETINS, UPLOADS AND SCHEDULING ARE KEPT MOUNTED (`KeptView`): each mounts on its first show and is `hidden` after, so
 * the place a person left survives a visit to another face, and each reads on open and on a press, never while hidden. Catalog
 * and History mount only while they show. The machine and fleet openings are the fleet's own and close as another face is chosen.
 *
 * THE HOSTS. One check sheet, opened from a need, a service row or a minute. One Mute dialog, opened from a need or the sheet, in
 * front of the sheet. One Promote dialog, from the sheet's diagnosis; a promotion that lands closes both and shows the Catalog. One
 * Enroll dialog and one Update wardens dialog, from the fleet. Each is mounted only while it is open.
 *
 * For src/modules/project-workspace's `WorkspaceMain`, which draws it as the Cerberus screen, through this module's barrel.
 */
export function CerberusPanel({ projectChoices }: CerberusPanelProps) {
  const { t } = useTranslation();
  const hostWindow = useHostWindow();
  const { overview, unreachable, stale, refresh, wardens } = useCerberus();

  // How many of Try again's reads have finished: both banners are keyed by it, so a retry that fails again is mounted afresh.
  const [attempt, setAttempt] = useState(0);
  // The face the foot shows: the person's place among the screen's faces, kept for as long as the screen stands.
  const [view, setView] = useState<CerberusView>('fleet');
  // The faces' scroller, whose offset the kept faces keep through a visit to another face.
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { shownOnce, leaving } = useKeptViews(view, scrollerRef);
  // The check the sheet is open on and the moment its lookup opens at; null while the sheet is closed.
  const [sheet, setSheet] = useState<CerberusSheetTarget | null>(null);
  // The check the Mute dialog is open on; null while it is closed.
  const [muting, setMuting] = useState<CerberusCheckView | null>(null);
  // The diagnosis the Promote dialog is open on, with the check it diagnosed; null while it is closed.
  const [promoting, setPromoting] = useState<{ diagnosis: CerberusDiagnosisView; check: CerberusCheckView } | null>(null);
  const [enrolling, setEnrolling] = useState(false);
  const [updatingWardens, setUpdatingWardens] = useState(false);
  // The machine whose Opening hangs from its mark, by id; and what else hangs from the instrument. One at a time.
  const [openNodeId, setOpenNodeId] = useState<string | null>(null);
  const [other, setOther] = useState<OtherOpening | null>(null);

  const onRetry = () => {
    void refresh().then(() => setAttempt((finished) => finished + 1));
  };
  const onView = (next: CerberusView) => {
    leaving(next);
    setOpenNodeId(null);
    setOther(null);
    setView(next);
  };
  const onOpenSheet = (target: CerberusSheetTarget) => setSheet(target);
  const onMute = (check: CerberusCheckView) => setMuting(check);
  const onPromote = (diagnosis: CerberusDiagnosisView, check: CerberusCheckView) => setPromoting({ diagnosis, check });
  // A promotion landed: the dialog and the sheet behind it go, and the Catalog shows the new entry, newest first with its "New" wash.
  const onPromoted = () => {
    setPromoting(null);
    setSheet(null);
    onView('catalog');
  };
  const onEnroll = () => setEnrolling(true);
  const onUpdateWardens = () => setUpdatingWardens(true);
  const openNode = (nodeId: string | null) => {
    setOther(null);
    setOpenNodeId(nodeId);
  };
  const openOther = (next: OtherOpening) => {
    setOpenNodeId(null);
    setOther(next);
  };

  // THE FLEET AS RINGS, worked out again on every read: worst first, the open machine facing on its ring.
  const items = useMemo(() => (overview === null ? [] : fleetItems(overview)), [overview]);
  const rings = fleetRings(items, overview?.nodes ?? [], openNodeId, t);
  const ringsRef = useRef<AstrolabeRingsHandle>(null);
  const fixingNode = items.find((item) => item.status === 'fixing')?.id ?? null;
  const doing: FleetDoing = overview === null ? { kind: 'quiet' }
    : fixingNode !== null ? { kind: 'fixing', nodeId: fixingNode }
      : overview.counts.needsYou > 0 ? { kind: 'needs' }
        : items.some((item) => groupOf(item.status) === 'updating') ? { kind: 'updating' }
          : { kind: 'quiet' };
  // The core's one measure: the share of the fleet's checks passing. A share passing is never a load, so it never runs warm.
  const gauge: AstrolabeRingGauge | null = overview === null || overview.counts.checks === 0 ? null : {
    value: overview.counts.passing / overview.counts.checks,
    label: t('cerberus.status.ok'),
    detail: `${overview.counts.passing} ${t('cerberus.header.summary.of', { count: overview.counts.checks })}`,
    warn: 2,
    danger: 2,
  };

  // Where an Opening hangs: a machine's own mark, or its ring's "more" mark for one past the marks; the core; a ring's "more" mark.
  const placesRef = useRef({ rings, openNodeId });
  useEffect(() => {
    placesRef.current = { rings, openNodeId };
  });
  const nodeAnchor = useCallback((): AstrolabePoint | null => {
    const { rings: held, openNodeId: nodeId } = placesRef.current;
    if (nodeId === null) return null;
    const ringId = held.ringOf(nodeId);
    if (ringId === null) return null;
    const onMark = held.rings.find((ring) => ring.id === ringId)?.items.some((item) => item.id === nodeId) ?? false;
    return ringsRef.current?.pointOf(ringId, onMark ? nodeId : moreMarkId(ringId)) ?? null;
  }, []);
  const homeRef = useRef<HTMLDivElement>(null);
  const coreAnchor = useCallback((): AstrolabePoint | null => {
    const box = homeRef.current?.querySelector('[data-ast-rings]')?.getBoundingClientRect();
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  }, []);
  const moreAnchor = useCallback((ringId: string) => () => ringsRef.current?.pointOf(ringId, moreMarkId(ringId)) ?? null, []);
  // The instrument's box: an Opening stands clear of it where the room allows, so the rings stay whole beside it.
  const instrumentBox = useCallback(() => homeRef.current?.querySelector('[data-cerberus-instrument]')?.getBoundingClientRect() ?? null, []);

  // The home's room, for the instrument's square: as large as the room allows, up to the design system's home size.
  const [room, setRoom] = useState({ w: 0, h: 0 });
  const hasFleet = overview !== null;
  useEffect(() => {
    const home = homeRef.current;
    if (!home) return undefined;
    const observer = resizeObserverIn(hostWindow, ([entry]) => setRoom({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    observer?.observe(home);
    return () => observer?.disconnect();
  }, [hostWindow, hasFleet]);
  const square = Math.max(0, Math.min(room.w - 16, room.h - 16, INSTRUMENT_HOME));

  const instrument = (docked: boolean) => (
    <CerberusInstrument
      ringsRef={ringsRef}
      rings={rings.rings}
      doing={doing}
      gauge={gauge}
      docked={docked}
      hold={openNodeId !== null || other !== null}
      onOpen={(item) => {
        const ringId = ringOfMoreMark(item.id);
        if (ringId !== null) openOther({ kind: 'more', ringId: ringId as FleetRingId });
        else openNode(item.id);
      }}
      onCore={() => openOther({ kind: 'fleet' })}
      onGauge={() => onView('history')}
    />
  );

  const openItem = openNodeId === null ? null : items.find((item) => item.id === openNodeId) ?? null;
  const openNodeView = openNodeId === null ? null : overview?.nodes.find((node) => node.id === openNodeId) ?? null;
  const openMark = openItem === null ? null : nodeMark(openItem.status);
  const headline = overview === null ? null : fleetHeadline(t, overview);
  const moreRingId = other?.kind === 'more' ? other.ringId : null;
  const moreMachines = moreRingId === null ? [] : (rings.machinesOf[moreRingId] ?? []).filter((nodeId) => !rings.rings.find((ring) => ring.id === moreRingId)?.items.some((item) => item.id === nodeId));

  return (
    <div data-cerberus-panel="" data-cerberus-face={view} className="flex h-full min-h-0 flex-col bg-background text-foreground [container-type:inline-size]">
      <ProjectChoicesContext.Provider value={projectChoices}>
        {/* THE SCENE: the instrument at home, or the face chosen as the work. Every Opening is drawn inside it and measures its room here. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
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
              {stale && (
                // The fleet below is the last answer center gave, not this minute's.
                <div key={attempt} className={cn('flex-none pt-3', GUTTER, VIEW_ENTER)}>
                  <UnreachableBanner onRetry={onRetry} detail={t('cerberus.errors.lastAnswer')} />
                </div>
              )}
              <div ref={homeRef} className="relative min-h-0 flex-1">
                {view === 'fleet' && (
                  <div role="tabpanel" aria-label={t('cerberus.fleet.tabs.fleet')} className="flex h-full items-center justify-center">
                    <div data-ast-keeps-opening="" data-cerberus-instrument="" style={{ width: square, height: square }}>
                      {square > 0 && instrument(false)}
                    </div>
                  </div>
                )}
                {/* The other faces scroll here; kept faces stay mounted, hidden, while the fleet is shown. */}
                <ScrollArea ref={scrollerRef} className={cn('h-full', view === 'fleet' && 'hidden')}>
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
                  <KeptView id="tours" view={view} shownOnce={shownOnce} label={t('cerberus.tours.tab')}>
                    <AffectedAreasView />
                  </KeptView>
                  <KeptView id="bulletins" view={view} shownOnce={shownOnce} label={t('cerberus.bulletins.tab')}>
                    <BulletinsView />
                  </KeptView>
                  <KeptView id="uploads" view={view} shownOnce={shownOnce} label={t('cerberus.uploads.tab')}>
                    <UploadsView shown={view === 'uploads'} />
                  </KeptView>
                  <KeptView id="scheduling" view={view} shownOnce={shownOnce} label={t('cerberus.scheduling.tab')}>
                    <SchedulingView shown={view === 'scheduling'} />
                  </KeptView>
                </ScrollArea>
              </div>

              {/* A machine, hung from its mark. */}
              {view === 'fleet' && openItem !== null && openNodeView !== null && (
                <Opening
                  open
                  anchor={nodeAnchor}
                  avoid={instrumentBox}
                  onClose={() => setOpenNodeId(null)}
                  backLabel={t('buttons.close')}
                  source={ringLabel(t, rings.ringOf(openItem.id) ?? 'silent')}
                  title={openItem.id}
                  status={{ word: machineWord(t, openItem.status), tone: openMark === null ? 'neutral' : markLook(openMark).tone }}
                  width={460}
                  marks={{ 'data-cerberus-node-opening': openItem.id }}
                >
                  <NodeOpening item={openItem} node={openNodeView} overview={overview} onOpenCell={onOpenSheet} onMute={onMute} />
                </Opening>
              )}

              {/* The fleet itself, hung from the core. */}
              {view === 'fleet' && headline !== null && (
                <Opening
                  open={other?.kind === 'fleet'}
                  anchor={coreAnchor}
                  avoid={instrumentBox}
                  onClose={() => setOther(null)}
                  backLabel={t('buttons.close')}
                  source={t('cerberus.header.eyebrow')}
                  title={(
                    <span>
                      {headline.lead} <em data-tone={headline.tone} className="not-italic text-tone-ink">{headline.accent}</em>
                    </span>
                  )}
                  width={380}
                  marks={{ 'data-cerberus-fleet-plate': '' }}
                >
                  <FleetOpening overview={overview} stale={stale} wardens={wardens} onEnroll={onEnroll} onUpdateWardens={onUpdateWardens} />
                </Opening>
              )}

              {/* A ring's further machines, hung from its "more" mark: each a press that opens it. */}
              {view === 'fleet' && moreRingId !== null && (
                <Opening
                  open
                  anchor={moreAnchor(moreRingId)}
                  avoid={instrumentBox}
                  onClose={() => setOther(null)}
                  backLabel={t('buttons.close')}
                  source={ringLabel(t, moreRingId)}
                  title={t('cerberus.ring.more', { count: moreMachines.length, defaultValue: '{{count}} more' })}
                  marks={{ 'data-cerberus-more-opening': moreRingId }}
                >
                  <ul className="-mx-2 flex flex-col">
                    {moreMachines.map((nodeId) => (
                      <li key={nodeId}>
                        <Button variant="ghost" size="sm" className="w-full justify-start truncate font-normal finger:min-h-11" onClick={() => openNode(nodeId)}>
                          {nodeId}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </Opening>
              )}
            </>
          )}
        </div>

        <CerberusFoot
          face={view}
          onFace={onView}
          needs={overview?.counts.needsYou ?? 0}
          onEnroll={overview === null ? undefined : onEnroll}
          docked={view !== 'fleet' && overview !== null ? instrument(true) : null}
        />
      </ProjectChoicesContext.Provider>

      {/* The hosts, each portalled over the screen while it is open. The Mute dialog opened from the sheet lands in front of it. */}
      {sheet !== null && (
        <CheckSheet
          open
          onClose={() => setSheet(null)}
          node={sheet.node}
          service={sheet.service}
          check={sheet.check}
          lookupAt={sheet.lookupAt}
          run={sheet.run}
          onMute={onMute}
          onPromote={onPromote}
        />
      )}
      <MuteDialog open={muting !== null} check={muting} onClose={() => setMuting(null)} />
      <PromoteDialog
        open={promoting !== null}
        diagnosis={promoting?.diagnosis ?? null}
        check={promoting?.check ?? null}
        onClose={() => setPromoting(null)}
        onPromoted={onPromoted}
      />
      <EnrollDialog open={enrolling} onClose={() => setEnrolling(false)} />
      <UpdateWardensDialog open={updatingWardens} onClose={() => setUpdatingWardens(false)} />
    </div>
  );
}
