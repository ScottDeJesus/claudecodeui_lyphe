import '@/modules/station/stationScene.css';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { CompanionActionCard, useCompanion } from '@/modules/companion';
import { RoadmapCircle, RoadmapStanding } from '@/modules/roadmap';
import { useStation } from '@/modules/station/context/StationContext';
import { useLivePending } from '@/modules/station/hooks/useLivePending';
import { StationArrival } from '@/modules/station/StationArrival';
import { stationArrangementOf } from '@/modules/station/stationArrangement';
import { StationKaylee } from '@/modules/station/StationKaylee';
import type { StationKayleeForm } from '@/modules/station/StationKaylee';
import { StationStage } from '@/modules/station/StationStage';
import { StationTalk } from '@/modules/station/StationTalk';
import { openHome } from '@/shared/cloudcliDoors';
import { ROADMAP_CIRCLE_AT_DESK, ROADMAP_CIRCLE_ON_PHONE } from '@/shared/constants';
import { useIsPageHeld } from '@/shared/context/HeldPageContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import { useStationDoors } from '@/shared/context/StationLayerContext';
import type { RoadmapStackRest, StationArrangement } from '@/shared/types';
import { otherOverlayHoldsEscape } from '@/shared/ui/overlayEscape';

/** The companion's column beside the panel, in px, where the screen has room for two columns: the panel keeps the rest, about two thirds. */
const KAYLEE_COLUMN: Record<'wide' | 'laptop', number> = { wide: 420, laptop: 340 };

/**
 * The panel's track at most, in px: its words run to 1,100 px, as a chat's do at a desk, with the panel's padding, edge and the air at
 * its end. Past it the companion's column and the panel stand as one block in the middle of the screen, so what is on the panel uses
 * the panel's width rather than a strip of it.
 */
const STAGE_TRACK_MAX = 1152;

/** Where the roadmap's circle rests while a thing is on the panel: the middle of the companion's column, over the halo. */
const CIRCLE_TOP = 66;
const CIRCLE_RADIUS = 33;

/** Where the roadmap's circle rests on a phone, at the head's start: the sessions home's own place for it, so it does not move between the two. */
const CIRCLE_ON_PHONE: RoadmapStackRest = ROADMAP_CIRCLE_ON_PHONE;

/** The halo's width in px, by where it stands: beside the lines, over them in the companion's column, and on a phone. */
const HALO_BESIDE = 300;
const HALO_ON_PHONE = 264;

/** What the scene is made of, each a drawn piece, so the layout stays a pure view. */
type StationScenePieces = {
  /** The stage, drawn: `StationStage` on the page, `StationStageView` on a fixture. */
  stage: ReactNode;
  /** The companion on the scene (`StationKaylee` on the page), in the form and at the halo's width the layout asks for. */
  kaylee: (form: StationKayleeForm, haloWidth: number) => ReactNode;
  /** The roadmap standing over the companion while nothing is on the panel (`RoadmapStanding` on the page). */
  road: ReactNode;
  /** The roadmap as its small circle, drawn at the rest it is handed (`RoadmapCircle` on the page). */
  circle: (rest: RoadmapStackRest) => ReactNode;
  /** The action the companion holds for your word, as its card on its arrival; nothing while none stands. */
  action: ReactNode;
  /** The one box: the field, the plus that attaches, the talk press and send (`StationTalk`'s `box`). */
  talk: ReactNode;
};

type StationShellViewProps = {
  /**
   * The arrangement: `wide` (≥ 1360 px) and `laptop` (1024–1359 px), two columns while a thing is on the panel; `compact` (below
   * 1024 px) and `phone` (a phone, upright or on its side), one column always.
   */
  arrangement: StationArrangement;
  /** A phone on its side: too short for the halo over the lines, so they stand side by side. */
  sideways: boolean;
  /**
   * Whether the stage holds a thing (the station's focus is set): the panel then has the screen and the companion stands beside or
   * over it; with nothing staged the screen is the roadmap and the companion.
   */
  staged: boolean;
  /** The scene's pieces. */
  scene: StationScenePieces;
};

/**
 * THE STATION'S LAYOUT: the companion, the panel, the roadmap and the box to type in. Nothing else, at every width.
 *
 * THE ROOT IS THE WORKSPACE FRAME'S OWN BOX (`WorkspaceFrame`): `pwa-status-clear fixed inset-0`, its bottom riding
 * `--keyboard-height`, so in the home-screen app it clears the status bar and the notch and its foot lifts over the on-screen
 * keyboard; the body pads by `--safe-area-inset-bottom`, clearing the home indicator. The page never scrolls as a document: its
 * parts scroll inside it. Sheets, dialogs and menus the station opens never take `pwa-status-clear`: an overlay covers the whole
 * screen and pads its own content.
 *
 * - AT REST (nothing on the panel): the roadmap stands in the room over the companion (`road`), the whole stack already up; under it
 *   the companion, the halo at the start with the lines beside it, on the measure the box under it shares. The stage's cell keeps
 *   only the shelf of the companion's cards between the two, while the shelf has any. ON A PHONE there is no room for the stack
 *   and the halo both, so the roadmap is its small circle at the head's start, as on the sessions home (a tap stands it over the
 *   screen), and the companion has the middle: the halo over the lines, or beside them with the phone on its side.
 * - WITH A THING ON THE PANEL, WIDE AND LAPTOP: two columns. The companion's own at the start (the halo, the name, the lines under
 *   it), the roadmap over it as its small circle (`circle`); the panel takes the rest, a surface of its own, arriving on the lock
 *   spring, up to `STAGE_TRACK_MAX`. Past that the two columns stand as one block in the middle of the screen, and what is on the
 *   panel runs to the panel's width.
 * - WITH A THING ON THE PANEL, ONE COLUMN (below 1024 px, and a phone): the companion is a mark at the head, the core alone with
 *   the lines beside it, and the panel has the screen under it. The roadmap is not drawn.
 * - AT THE FOOT, on the box's measure: the action the companion holds out for your yes, its row opening to the card's height as it
 *   arrives and closing as it settles; then the one box. The draft waiting on your Send takes no room here: it is a bead on the
 *   companion's core, and opens beside the core when pressed (`StationDraftAlert`).
 *
 * The companion's cell and the stage's cell are the same two boxes in every case: only their places on the grid change
 * (`stationScene.css`, keyed on `data-station-scene` and `data-station-arrangement`), so neither is re-parented and each keeps its
 * state across the change.
 *
 * The way out is the companion's core, pressed (the sessions home), or Escape.
 *
 * A pure view: `StationShell` below binds it to the station.
 */
export function StationShellView({ arrangement, sideways, staged, scene }: StationShellViewProps) {
  const twoColumns = arrangement === 'wide' || arrangement === 'laptop';
  const phone = arrangement === 'phone';
  const column = twoColumns ? KAYLEE_COLUMN[arrangement] : 0;
  const form: StationKayleeForm = staged ? (twoColumns ? 'under' : 'mark') : phone && !sideways ? 'under' : 'beside';
  const haloWidth = form === 'beside' ? (phone ? HALO_ON_PHONE : HALO_BESIDE) : twoColumns ? Math.min(column - 40, 380) : HALO_ON_PHONE;
  // The scene's width, for where the two columns' block starts once the panel has reached its most and the block stands in the middle.
  const sceneRef = useRef<HTMLDivElement>(null);
  const [sceneWidth, setSceneWidth] = useState(0);
  useLayoutEffect(() => {
    const box = sceneRef.current;
    if (box === null) return undefined;
    const measure = () => setSceneWidth(Math.round(box.getBoundingClientRect().width));
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(box);
    return () => observer?.disconnect();
  }, []);
  const blockStart = staged && twoColumns ? Math.max(0, Math.round((sceneWidth - column - STAGE_TRACK_MAX) / 2)) : 0;
  // The roadmap's small circle: over the companion's column beside the panel, and at a phone's head while the panel is empty.
  const circle = staged ? (twoColumns ? { cx: blockStart + column / 2, cy: CIRCLE_TOP, radius: CIRCLE_RADIUS } : null) : phone ? CIRCLE_ON_PHONE : null;

  return (
    <div
      data-station-shell=""
      data-station-arrangement={arrangement}
      className="pwa-status-clear fixed inset-0 flex flex-col bg-background"
      style={{ bottom: 'var(--keyboard-height, 0px)' }}
    >
      <main data-station-body="" className="flex min-h-0 flex-1 flex-col pb-[var(--safe-area-inset-bottom)]">
        <div ref={sceneRef} data-station-scene={staged ? 'staged' : 'rest'} className="relative flex min-h-0 flex-1 flex-col">
          <div data-station-scene-grid="" className="grid min-h-0 flex-1" style={{ '--kaylee-col': `${column}px`, '--stage-max': `${STAGE_TRACK_MAX}px` } as CSSProperties}>
            {!staged && !phone && <div data-station-road="" className="min-h-0 min-w-0">{scene.road}</div>}
            <div data-station-kaylee-cell="" className="flex min-h-0 min-w-0 flex-col">{scene.kaylee(form, haloWidth)}</div>
            <div data-station-stage-cell="" className="flex min-h-0 min-w-0 flex-col">{scene.stage}</div>
          </div>
          <div data-station-foot="" className="mx-auto w-full max-w-[720px] shrink-0">
            <div data-station-held="" data-station-slot="action" className="px-3">{scene.action}</div>
            <div data-station-slot="talk">{scene.talk}</div>
          </div>
          {circle !== null && scene.circle(circle)}
        </div>
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
 * The station on the page: what `StationRoute` renders inside the station's provider. It reads the tier and the stage's focus and
 * hands them, with the scene's live pieces, to `StationShellView`.
 *
 * THE ARRANGEMENT is `phone` first, on a phone (`useStation().phone`: a window under 768 px wide, or a touch window under 500 px
 * tall); else compact below 1024 px (the tier `narrow`: a tablet, the second monitor, a small window); else the tier's. It follows
 * `resize` and the pointer query's `change` (the context reads both), never a timer. There is no Compact switch, so a stored one
 * is not read.
 *
 * ESCAPE is the way back: it puts away what is on the panel, and with nothing there goes to the sessions home. It stands down for
 * anything open in front (a sheet, a menu, a dialog, the roadmap's stack stood up, a card on it), for a press another listener has
 * taken, for a key typed into a field, and while the station is held under another page.
 *
 * A LETTER TYPED WITH NOTHING IN FOCUS goes to the box: the field takes the focus on the key's way down, so the letter lands in it.
 */
export function StationShell() {
  const { tier, phone, sideways, focus, setFocus, canGoBack, back } = useStation();
  const doors = useStationDoors();
  const hostWindow = useHostWindow();
  const isPageHeld = useIsPageHeld();
  const arrangement = stationArrangementOf(tier, phone, false);
  const staged = focus !== null;
  // How many times the reader has come from the sessions home by Kaylee's core there: the stack arrives from the home's circle each time.
  // Asked once as the station mounts (a first visit, its chunk loaded after the press) and again each time it comes back on screen.
  const [arrivals, setArrivals] = useState(0);
  useEffect(() => {
    const arrive = () => {
      if (doors.showing() && doors.takeRoadmapTravel('station')) setArrivals((count) => count + 1);
    };
    arrive();
    return doors.onShowingChange(arrive);
  }, [doors]);
  // The way home. With the stack standing (nothing on the panel, and not a phone, which has only the circle), the roadmap goes with the reader.
  const goHome = useCallback(() => {
    if (!staged && arrangement !== 'phone') doors.markRoadmapTravel('home');
    openHome(doors.navigate);
  }, [staged, arrangement, doors]);

  useEffect(() => {
    const hostDocument = hostWindow.document;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || isPageHeld() || !doors.showing() || otherOverlayHoldsEscape(hostDocument)) return;
      if (event.key === 'Escape') {
        // Something drawn over the station that states nothing about the key (Settings, opened from the menu by the companion's
        // name): the key is that thing's, and the station under it is not walked away.
        const shell = hostDocument.querySelector('[data-station-shell]');
        const inFront = hostDocument.elementFromPoint(hostWindow.innerWidth / 2, hostWindow.innerHeight / 2);
        if (shell !== null && inFront !== null && !shell.contains(inFront)) return;
        // A key typed into a field is the field's: `closest` is asked of the node itself, whichever window made it.
        const field = (event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]') ?? null;
        if (field !== null) return;
        event.preventDefault();
        // The key is the way back: to what stood on the panel before this, as the panel's own arrow goes; then the panel put away; then home.
        if (staged && canGoBack) back();
        else if (staged) setFocus(null);
        else goHome();
        return;
      }
      // One printable character, unmodified, with the focus on nothing: it is meant for the companion.
      const nothingFocused = hostDocument.activeElement === null || hostDocument.activeElement === hostDocument.body;
      if (!nothingFocused || event.key.length !== 1 || event.key === ' ' || event.ctrlKey || event.metaKey || event.altKey) return;
      hostDocument.querySelector<HTMLElement>('[data-station-shell] [data-companion-composer-field]')?.focus();
    };
    // On the window's capture, as the panels that own the key listen: asked before any of them has closed, so what is open in front
    // is still there to be seen. It stops nothing: the key goes on to whoever owns it.
    hostWindow.addEventListener('keydown', onKeyDown, true);
    return () => hostWindow.removeEventListener('keydown', onKeyDown, true);
  }, [staged, canGoBack, back, hostWindow, isPageHeld, doors, setFocus, goHome]);

  return (
    <StationShellView
      arrangement={arrangement}
      sideways={sideways}
      staged={staged}
      scene={{
        stage: <StationStage />,
        kaylee: (form, haloWidth) => <StationKaylee form={form} haloWidth={haloWidth} onHome={goHome} />,
        road: <RoadmapStanding arriveFrom={ROADMAP_CIRCLE_AT_DESK} arrivals={arrivals} />,
        circle: (rest) => <RoadmapCircle rest={rest} />,
        action: <StationHeldAction />,
        talk: <StationTalk tier={tier} density="full" part="box" />,
      }}
    />
  );
}
