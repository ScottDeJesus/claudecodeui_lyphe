import '@/modules/station/stationScene.css';

import { useEffect } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionActionCard, useCompanion } from '@/modules/companion';
import { RoadmapCircle, RoadmapStanding } from '@/modules/roadmap';
import { useStation } from '@/modules/station/context/StationContext';
import { useLivePending } from '@/modules/station/hooks/useLivePending';
import { StationArrival } from '@/modules/station/StationArrival';
import { stationArrangementOf } from '@/modules/station/stationArrangement';
import { StationBar } from '@/modules/station/StationBar';
import { StationCompact } from '@/modules/station/StationCompact';
import { StationKaylee } from '@/modules/station/StationKaylee';
import { StationPhone } from '@/modules/station/StationPhone';
import { STATION_REGIONS } from '@/modules/station/stationRegions';
import { StationStage } from '@/modules/station/StationStage';
import { StationTalk } from '@/modules/station/StationTalk';
import { backToCloudcli, openHome } from '@/shared/cloudcliDoors';
import { useIsPageHeld } from '@/shared/context/HeldPageContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { RoadmapStackRest, StationArrangement, StationDensity, StationSlot } from '@/shared/types';
import { otherOverlayHoldsEscape } from '@/shared/ui/overlayEscape';
import { cn } from '@/shared/utils';

/** What the layout holds in each slot: a region, drawn. A slot left out (or null) draws nothing. */
type StationSlots = Partial<Record<StationSlot, ReactNode>>;

/** The companion's column beside the panel, in px, by the scene's arrangement: the panel keeps the rest, about two thirds. */
const KAYLEE_COLUMN: Record<'wide' | 'laptop', number> = { wide: 420, laptop: 340 };

/** Where the roadmap's circle rests while a thing is on the panel: the middle of the companion's column, over the core. */
const CIRCLE_TOP = 66;
const CIRCLE_RADIUS = 33;

/** What the scene draws beside its regions: each a drawn piece, so the layout stays a pure view. */
type StationScenePieces = {
  /** The companion on the scene (`StationKaylee` on the page), in the form the stage's focus gives it. */
  kaylee: ReactNode;
  /** The roadmap standing over the companion while nothing is on the panel (`RoadmapStanding` on the page). */
  road: ReactNode;
  /** The roadmap as its small circle over the companion's column while a thing is on the panel, drawn at the rest it is handed. */
  circle: (rest: RoadmapStackRest) => ReactNode;
  /** The action the companion holds for your word, as its card on its arrival; nothing while none stands. */
  action: ReactNode;
};

type StationShellViewProps = {
  /**
   * The arrangement: `wide` (≥ 1360 px) and `laptop` (1024–1359 px), the scene; `compact` (below 1024 px) or `phone` (a phone,
   * upright or on its side).
   */
  arrangement: StationArrangement;
  /** Each slot's region, drawn for the window's tier and the arrangement's density. The scene places its few here; compact and the phone draw their own. */
  slots: StationSlots;
  /** The stage, drawn: `StationStage` on the page, `StationStageView` on a fixture. Compact's Stage section holds its own. */
  stage: ReactNode;
  /**
   * Whether the stage holds a thing (the station's focus is set): the scene is then the companion's column beside the panel;
   * with nothing staged it is the roadmap standing over the companion.
   */
  staged: boolean;
  /** The scene's own pieces (the companion, the roadmap in its two forms, the held action). */
  scene: StationScenePieces;
  /** Compact, drawn (`StationCompact` on the page, `StationCompactView` on a fixture): the body while `arrangement` is `compact`. */
  compact: ReactNode;
  /**
   * The phone's arrangement, drawn (`StationPhone` on the page, `StationPhoneView` on a fixture): the whole frame while `arrangement`
   * is `phone`, its top row the bar.
   */
  phone: ReactNode;
  /** The bar's "CloudCLI", the way back to the workspace: compact's bar draws it. */
  onBackToCloudcli: () => void;
};

/**
 * THE SCENE'S BODY (wide and laptop): the companion, the panel, the roadmap and the box to type in. Nothing else.
 *
 * - AT REST (nothing on the panel): the roadmap stands in the room over the companion (`road`), the whole stack already up; under
 *   it the companion, the core at the start with the lines beside it, on the measure the box under it shares. The stage's cell
 *   keeps only the shelf of the companion's cards between the two, while the shelf has any.
 * - WITH A THING ON THE PANEL: two columns. The companion's own at the start (the core, the name, the lines under it), the roadmap
 *   over it as one small circle that stands up over the whole scene when pressed (`circle`); the panel takes the rest, a surface
 *   of its own, arriving on the lock spring.
 * - AT THE FOOT, on the box's measure: what the companion holds out for your word (the action waiting on your yes, then the draft
 *   waiting on your Send), each row opening to its piece's height as it arrives and closing as it settles; then the one box: the
 *   field, the plus that attaches, the talk press and send.
 *
 * The companion's cell and the stage's cell are the same two boxes in both: only their places on the grid change
 * (`stationScene.css`, keyed on `data-station-scene`), so neither is re-parented and each keeps its state across the change.
 */
function SceneBody({ arrangement, slots, stage, staged, scene }: {
  arrangement: 'wide' | 'laptop'; slots: StationSlots; stage: ReactNode; staged: boolean; scene: StationScenePieces;
}) {
  const column = KAYLEE_COLUMN[arrangement];
  return (
    <div data-station-scene={staged ? 'staged' : 'rest'} className="relative flex min-h-0 flex-1 flex-col">
      <div data-station-scene-grid="" className="grid min-h-0 flex-1" style={{ '--kaylee-col': `${column}px` } as CSSProperties}>
        {!staged && <div data-station-road="" className="min-h-0 min-w-0">{scene.road}</div>}
        <div data-station-kaylee-cell="" className="flex min-h-0 min-w-0 flex-col">{scene.kaylee}</div>
        <div data-station-stage-cell="" className="flex min-h-0 min-w-0 flex-col">{stage}</div>
      </div>
      <div data-station-foot="" className="mx-auto w-full max-w-[720px] shrink-0">
        <div data-station-held="" data-station-slot="action" className="px-3">{scene.action}</div>
        <div data-station-held="" data-station-slot="dock">{slots.dock}</div>
        <div data-station-slot="talk">{slots.talk}</div>
      </div>
      {staged && scene.circle({ cx: column / 2, cy: CIRCLE_TOP, radius: CIRCLE_RADIUS })}
    </div>
  );
}

/**
 * THE STATION'S LAYOUT: a body arranged by the arrangement.
 *
 * THE ROOT IS THE WORKSPACE FRAME'S OWN BOX (`WorkspaceFrame`): `pwa-status-clear fixed inset-0`, its bottom riding
 * `--keyboard-height`, so in the home-screen app it clears the status bar and the notch and its foot lifts over the on-screen
 * keyboard; the body pads by `--safe-area-inset-bottom`, clearing the home indicator (on a phone its bottom bar pads itself). The
 * page never scrolls as a document: its regions scroll inside it. Sheets, dialogs and menus the station opens never take
 * `pwa-status-clear`: an overlay covers the whole screen and pads its own content.
 *
 * - WIDE AND LAPTOP: THE SCENE (`SceneBody`): the companion, the panel, the roadmap and the box to type in, and no bar over them.
 *   The way out is the companion's core, pressed (the sessions home), or Escape.
 * - COMPACT (below 1024 px): one column under the bar — the companion's head, the strip's line, one switch, a section (`compact`,
 *   the caller's `StationCompactView`).
 * - PHONE (a phone, upright or on its side): the station made for the thumb (`phone`, the caller's `StationPhoneView`), the whole
 *   frame: the companion's head as its top row, which is the bar there (no `StationBar` is drawn), the strip's line, the section,
 *   and a bottom bar of the sections round the talk control, which pads itself by the home indicator's inset.
 *
 * A change of arrangement re-parents what moves (everything into compact's sections), so a region keeps its state in the
 * station's context or its scroll memory, never only in itself.
 *
 * A pure view: `StationShell` below binds it to the station, and the fixtures draw it on their pictures (`station-fake.ts`).
 */
export function StationShellView({ arrangement, slots, stage, staged, scene, compact, phone, onBackToCloudcli }: StationShellViewProps) {
  const body = arrangement === 'compact' ? compact : arrangement === 'phone' ? phone : (
    <SceneBody arrangement={arrangement} slots={slots} stage={stage} staged={staged} scene={scene} />
  );

  return (
    <div
      data-station-shell=""
      data-station-arrangement={arrangement}
      className="pwa-status-clear fixed inset-0 flex flex-col bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      {/* Above 1024 px compact is no longer an arrangement, so its switch is never drawn; nor is "Where things stand", the scene's. */}
      {arrangement === 'compact' && <StationBar strip={null} compactSwitch={null} onBackToCloudcli={onBackToCloudcli} onWhere={null} />}
      <main data-station-body="" className={cn('flex min-h-0 flex-1 flex-col', arrangement !== 'phone' && 'pb-[var(--safe-area-inset-bottom)]')}>
        {body}
      </main>
    </div>
  );
}

/**
 * The action the companion holds for your word, on the scene: its own card (`CompanionActionCard`, as its panel draws it: the
 * act and its target, when it lapses, the × that withdraws it), arriving from the foot and settling away when it is taken,
 * withdrawn or lapsed (`useLivePending`, the deadline the card draws by).
 */
function StationHeldAction() {
  const { t } = useTranslation();
  const { picture, cancelAction } = useCompanion();
  const pending = useLivePending(picture?.pending ?? null);
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });
  return (
    <StationArrival when={pending !== null} from="dock" className="pb-2">
      {pending !== null && <CompanionActionCard key={pending.id} pending={pending} name={name} onWithdraw={() => cancelAction(pending.id)} />}
    </StationArrival>
  );
}

/**
 * The station on the page: what `StationRoute` renders inside the station's provider. It reads the tier, the registered regions
 * and the stage's focus, and hands them, with the live stage and the scene's pieces, to `StationShellView`.
 *
 * THE ARRANGEMENT is `phone` first, on a phone (`useStation().phone`: a window under 768 px wide, or a touch window under 500 px
 * tall); else compact below 1024 px (the tier `narrow`: a tablet, the second monitor, a small window); else the tier's scene. It
 * follows `resize` and the pointer query's `change` (the context reads both), never a timer. The scene has no Compact switch, so
 * a stored one is not read.
 *
 * EVERY REGION'S DENSITY is `compact` in the one-column arrangements (compact's and the phone's) and `full` in the scene, handed to
 * each region with the tier.
 *
 * ESCAPE, IN THE SCENE, is the way back: it puts away what is on the panel, and with nothing there goes to the sessions home.
 * It stands down for anything open in front (a sheet, a menu, a dialog, the roadmap's stack stood up, a card on it), for a
 * press another listener has taken, for a key typed into a field, and while the station is held under another page.
 */
export function StationShell() {
  const { tier, phone, focus, setFocus } = useStation();
  const doors = useStationDoors();
  const hostWindow = useHostWindow();
  const isPageHeld = useIsPageHeld();
  const arrangement = stationArrangementOf(tier, phone, false);
  const scene = arrangement === 'wide' || arrangement === 'laptop';
  const density: StationDensity = scene ? 'full' : 'compact';
  const staged = focus !== null;
  // The way back to the workspace, for compact's bar and the phone's top row, its menu: as it stood when the station came forward.
  const onBackToCloudcli = () => backToCloudcli(doors.navigate, doors.workspacePath());

  useEffect(() => {
    if (!scene) return undefined;
    const hostDocument = hostWindow.document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || isPageHeld() || !doors.showing()) return;
      if (otherOverlayHoldsEscape(hostDocument)) return;
      // A key typed into a field is the field's: `closest` is asked of the node itself, whichever window made it.
      const field = (event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]') ?? null;
      if (field !== null) return;
      event.preventDefault();
      if (staged) setFocus(null);
      else openHome(doors.navigate);
    };
    // On the window's capture, as the panels that own the key listen: asked before any of them has closed, so what is open in front
    // is still there to be seen. It stops nothing: the key goes on to whoever owns it.
    hostWindow.addEventListener('keydown', onKeyDown, true);
    return () => hostWindow.removeEventListener('keydown', onKeyDown, true);
  }, [scene, staged, hostWindow, isPageHeld, doors, setFocus]);

  // Each slot with a registered region, drawn for this tier at the arrangement's density; a slot with none is left out, so it
  // draws nothing.
  const slots: StationSlots = {};
  for (const slot of Object.keys(STATION_REGIONS) as StationSlot[]) {
    const Region = STATION_REGIONS[slot];
    if (Region !== undefined) slots[slot] = <Region tier={tier} density={density} />;
  }
  // The scene's talk control is one box, the talk press inside it.
  if (scene) slots.talk = <StationTalk tier={tier} density={density} part="box" />;
  const stage = <StationStage />;
  return (
    <StationShellView
      arrangement={arrangement}
      slots={slots}
      stage={stage}
      staged={staged}
      scene={{
        kaylee: <StationKaylee form={staged ? 'under' : 'beside'} />,
        road: <RoadmapStanding />,
        circle: (rest) => <RoadmapCircle rest={rest} />,
        action: <StationHeldAction />,
      }}
      compact={arrangement === 'compact' ? <StationCompact slots={slots} stage={stage} tier={tier} /> : null}
      phone={arrangement === 'phone' ? <StationPhone slots={slots} stage={stage} onBackToCloudcli={onBackToCloudcli} /> : null}
      onBackToCloudcli={onBackToCloudcli}
    />
  );
}
