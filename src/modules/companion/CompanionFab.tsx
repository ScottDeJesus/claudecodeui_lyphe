import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { AnimationEvent, CSSProperties, ReactNode, TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';

import '@/modules/companion/CompanionFab.css';
import { CompanionFace } from '@/modules/companion/CompanionFace';
import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { useAvatarTarget } from '@/modules/companion/hooks/useAvatarTarget';
import { useCompanionPresence } from '@/modules/companion/hooks/useCompanionPresence';
import { useCompanionSize } from '@/modules/companion/hooks/useCompanionSize';
import { useFaceLook } from '@/modules/companion/hooks/useFaceInputs';
import { useReducedMotion } from '@/modules/companion/hooks/useReducedMotion';
import { useSizeEasing } from '@/modules/companion/hooks/useSizeEasing';
import { avatarPlacement } from '@/modules/companion/utils/avatarPlacement';
import { restFor, storedFrom } from '@/modules/companion/utils/fabGrowth';
import { presenceWords } from '@/modules/companion/utils/presenceWords';
import { FAB_CATCH_PX, FAB_DEFAULT_INSET_X, FAB_DEFAULT_INSET_Y } from '@/shared/constants';
import { DockableFab } from '@/shared/ui';
import type { DockableFabPosition } from '@/shared/ui';

/** A point in viewport px: a disc's top-left. */
type FabPoint = { x: number; y: number };

/** Where she is drawn while she looks at something: the disc's top-left in viewport px, keyed by the anchor it stands beside. */
type CompanionFabTarget = { key: string; left: number; top: number };

/** The look the disc is drawing: the anchor's key, and whether her glide to it has ended (she stands beside it now). */
type CompanionFabLookDrawn = { key: string; landed: boolean };

/** What the kit's 1px accent rim takes of the disc's side, both edges together: her face is the disc less this, filling the circle inside the rim. */
const FACE_RIM_PX = 2;

/**
 * Her own corner on a phone, as the inset from the window's bottom-right corner to the disc's top-left: on the applications
 * button's line, one catch to its left. The applications button's phone default stands at (72, 112)
 * (`FAB_DEFAULT_INSET_X`/`_Y`, shared constants), so at the height the page loaded at the two discs
 * share a row and their 44px catches meet edge to edge without overlapping; she also clears the kit's own resting corner,
 * where the applications button sits when its record is docked and the rail is tucked away.
 *
 * WHAT SHE COVERS THERE, measured at 390x844 on a chat: none of the conversation, and about four characters of one line
 * of his text, beside the four the applications button already hides at that line's end. Typed, "navigate away from
 * the" reads "navigate aw[her]ro[applications]e": her disc hides "ay f", the applications button "m th"; empty, the
 * placeholder loses the same span. That line is a short message's only line; once the composer holds more, it is the
 * line before the one he is typing. With the keyboard up where the window resizes for it (Android), she rides up with
 * the window and stays on the field, while the applications button's stored point is clamped to the window's new foot,
 * so the two part (at 390x508: she at y 396 on the field, the applications button at y 472).
 *
 * WHY NOT ABOVE IT, where the design first drew her: one catch up is the conversation's newest lines (the last reply's
 * time and menu) and the lane a thumb starts its scroll in, and a scroll that starts on a catch drags the disc
 * (`touch-action: none`) — the house keeps a FAB's catch off the conversation's scroll for exactly that
 * (`FAB_DEFAULT_INSET_X`). Nor high in that column under the header: the Files view's folder chips
 * and the Git view's tabs stand there, and a press meant for them would open her panel.
 */
const CORNER_INSET: FabPoint = { x: FAB_DEFAULT_INSET_X + FAB_CATCH_PX, y: FAB_DEFAULT_INSET_Y };

/** The window's resize, heard only while she rests in her corner: nowhere else does the window's size place her. */
function listenToResize(listener: () => void): () => void {
  window.addEventListener('resize', listener);
  return () => window.removeEventListener('resize', listener);
}

/** No subscription: away from her corner, a resize moves her through the kit's own clamp and the dock's own report. */
function listenToNothing(): () => void {
  return () => {};
}

const readViewportWidth = () => window.innerWidth;
const readViewportHeight = () => window.innerHeight;

type CompanionFabViewProps = {
  /** Her name and what she is doing, in words ("Kaylee, reading Bugfixes"): the disc's accessible name and its tooltip. */
  label: string;
  /** Her face, filling the disc inside the kit's accent rim by CSS (it follows the disc's size as it eases). The disc frames it on her own ground. */
  face: ReactNode;
  /** The disc's side in px as she is drawn now: 28 at rest, larger while she is active (`useCompanionSize`). It grows about her centre. */
  size: number;
  /** Where she rests, as he left her: docked, or a point. */
  position: DockableFabPosition;
  /** The rail cell's rect while the rail is docked (md and up) and on screen, else null: on a phone she rests in her corner. */
  dockRect: DOMRect | null;
  /** Her panel is open: the disc reads as pressed (`aria-expanded`, the deep rim and the soft ring). */
  active: boolean;
  /** Where she is drawn while a look holds her, or null at rest. A new `key` is a new look: she glides there and hops. */
  target: CompanionFabTarget | null;
  /** A press that ended no drag — a tap, a click, Enter or Space: it opens or closes her panel. */
  onPress: () => void;
  /** Once per drag, at the release: docked, or the point where he let go. */
  onPositionChange: (next: DockableFabPosition) => void;
  /**
   * Her rest's box in viewport px, before any look's offset, each time it moves (a drop, the dock, a resize): where she
   * stands at home, so a look never sends her to an anchor she is already standing on (`useAvatarTarget`'s `buttonRect`).
   */
  onRestChange: (rect: DOMRect) => void;
  /**
   * The look the disc is drawing, reported from an effect each time it changes: null when none is drawn (none holds, a drag is in hand, or
   * a drag set the look aside), else its key and whether her glide to it has ended. The face turns toward her anchor only while one is
   * drawn, and from where she stands only once she has landed. Never called during render.
   */
  onLookDrawn?: (drawn: CompanionFabLookDrawn | null) => void;
};

/**
 * KAYLEE'S DISC, drawn: the kit's DockableFab, unchanged, holding her face, and the layer that carries her glide and her
 * hop. Exported for this file's CompanionFab, which binds it to her picture, and for `.verify/kaylee-fab-chrome.mjs`,
 * which seats it, drags it, sends it to fixture targets and photographs it.
 *
 * WHERE SHE RESTS. Docked, in the rail cell her door held (CompanionDock), where the disc IS her door: a press opens or
 * closes her panel. Dragged out, wherever he dropped her, and a drop near the cell docks her again (the kit's snap). On a
 * phone the rail lives in the drawer and the dock reports no rect, so she rests in her own corner, beside the
 * applications button on its line over the composer (`CORNER_INSET`), handed to the kit as a point so its clamp holds her
 * inside the safe area and she wears the floating look the applications button wears beside her. The drawer opening and
 * closing never moves her.
 *
 * WHERE SHE LOOKS. While a look holds her she is drawn at `target` and is still resting where she rests: rest and target
 * are one `translate` on this layer — none at rest, target less rest on a look — eased over 450 ms, with a 200 ms hop
 * once she lands. Landed, she is fixed to her anchor: a new measurement of the same look (the list scrolling under her)
 * moves her at once, with no glide to trail it. Coming home is the same glide back, without the hop. Reduced motion
 * jumps, and never hops.
 *
 * WHY A LAYER. The kit's button scales itself on hover and press with its own `transform`, and is one fixed node for its
 * whole life, so her glide cannot be its transform. The layer is fixed, covers the viewport and passes every pointer
 * through but the disc's own; its translate makes it the disc's containing block, and its box is the viewport, so the
 * kit's left and top mean what they always mean. The disc's rest is learned from the kit's own `onRectChange` (its
 * placed rect, after every placement and on every resize) less this layer's drawn offset at that instant, and handed on
 * through `onRestChange`.
 *
 * HOW BIG. `size` is the disc's side (`useCompanionSize`), written on this layer as `--companion-fab-size`, which CompanionFab.css hands
 * the kit as its own `--vv-fab-size`: only her disc grows. The rest is stored for the 28 px disc, so a point is handed to the kit
 * shifted back by half the growth (`restFor`) and a drop is stored shifted forward (`storedFrom`), and the disc grows about its centre.
 * The disc eases its geometry only while the size changes (`data-resizing`, `useSizeEasing`); the kit reports its rect as it eases.
 *
 * A DRAG CANCELS ANY MOTION. From the first move the offset drops at once, with no glide to trail the finger, and the
 * look in hand is set aside until another begins, so the drop is where she stays. The drop sets her new rest.
 *
 * STACKING, in the workspace shell's stacking context. From md up, z 59, one rung under the applications button's 60:
 * over every application (40), the floating chat and her own desktop panel (45) — the disc is how that panel closes — and
 * the docked rail (`relative z-50`), where she sits in her cell. Under the applications button and the radial it fans out
 * (60), which stay on top wherever the two meet. Below md and at rest, z 49: still over the floating chat and the
 * applications, but under the sidebar's drawer (50), so an open drawer covers her corner — its cell draws her door — and
 * the controls of its rows stay his to press. While a look holds her she is at 59 at every width, so a look into the open
 * drawer is drawn over it. Below lg her panel is a sheet at 61 that covers both discs and carries its own close.
 */
export function CompanionFabView({ label, face, size, position, dockRect, active, target, onPress, onPositionChange, onRestChange, onLookDrawn }: CompanionFabViewProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const resizing = useSizeEasing(size);

  // Docked with nowhere to dock — the rail tucked away — she rests in her corner, which follows the window's size.
  const inCorner = position.docked && dockRect === null;
  const listen = inCorner ? listenToResize : listenToNothing;
  const viewportWidth = useSyncExternalStore(listen, readViewportWidth);
  const viewportHeight = useSyncExternalStore(listen, readViewportHeight);
  // Her rest, stored for the 28 px disc, handed to the kit shifted back by half the growth so the larger disc grows about the same centre.
  const rest: DockableFabPosition = restFor(
    inCorner ? { docked: false, x: viewportWidth - CORNER_INSET.x, y: viewportHeight - CORNER_INSET.y } : position,
    size,
  );

  // Her rest as the kit placed it: the disc's box in viewport px, before this layer's offset. State because the offset is
  // drawn from it, and only the kit knows it — docked it is the cell's centre, floating it is a CSS clamp against the safe
  // area — so it is set from the kit's own report, never worked out here.
  const [placed, setPlaced] = useState<DOMRect | null>(null);
  // Whether a drag is in hand, from its first move to its release: the offset drops at once and nothing glides.
  const [dragging, setDragging] = useState(false);
  // The look the last drag set aside: she stays where she was dropped while it holds. Dropped in the render that finds
  // another look, or none, so the next look moves her again.
  const [cancelledKey, setCancelledKey] = useState<string | null>(null);
  if (cancelledKey !== null && target?.key !== cancelledKey) setCancelledKey(null);

  // The look she is drawn at now: none while a drag is in hand, and none the drag set aside.
  const shown = target !== null && target.key !== cancelledKey && !dragging ? target : null;

  // The look she has landed at, and whether its hop is drawing: set as the glide to a new look ends, the hop cleared as its
  // keyframe ends. She lands once per look, so a look's re-measures (a scroll, a resize) carry her along without another
  // hop. Dropped in the render that finds no look, so going home and coming back to the same anchor lands again.
  const [landed, setLanded] = useState<{ key: string; hopping: boolean } | null>(null);
  if (landed !== null && shown === null) setLanded(null);
  // Landed at the look she is drawn at: its new measurements apply at once, so she stays on her anchor while it moves.
  const tracking = landed !== null && shown !== null && landed.key === shown.key;
  const drawnKey = shown?.key ?? null;
  useEffect(() => {
    onLookDrawn?.(drawnKey === null ? null : { key: drawnKey, landed: tracking });
  }, [drawnKey, tracking, onLookDrawn]);

  // Where the layer draws her from her rest: nothing at rest, nor before the kit has placed her.
  const offset: FabPoint = shown !== null && placed !== null ? { x: shown.left - placed.x, y: shown.top - placed.y } : { x: 0, y: 0 };

  // The kit's placed rect, less the layer's drawn corner at the same instant: the layer covers the viewport, so its drawn
  // corner is exactly the offset it is drawing, mid-glide or mid-hop. At mount the layer's ref lands after the kit's first
  // report, and the layer draws no offset then. Skipped while a drag is in hand: the release reports the new rest.
  function handleRectChange(rect: DOMRect) {
    if (dragging) return;
    const drawn = layerRef.current?.getBoundingClientRect();
    const next = new DOMRect(rect.left - (drawn?.left ?? 0), rect.top - (drawn?.top ?? 0), rect.width, rect.height);
    if (placed !== null && placed.x === next.x && placed.y === next.y && placed.width === next.width && placed.height === next.height) return;
    setPlaced(next);
    onRestChange(next);
  }

  function handleDragStart() {
    setDragging(true);
    setCancelledKey(target?.key ?? null);
  }

  // The kit reports a drop as the top-left of the disc as large as it is; what is stored is the 28 px disc's about the same centre.
  function handlePositionChange(next: DockableFabPosition) {
    setDragging(false);
    onPositionChange(storedFrom(next, size));
  }

  // Her own glide ending, not one of the disc's or her face's that bubbled up: a hop where she arrives at a new look.
  function handleTransitionEnd(event: TransitionEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget || event.propertyName !== 'translate') return;
    if (shown === null || landed?.key === shown.key) return;
    setLanded({ key: shown.key, hopping: true });
  }

  function handleAnimationEnd(event: AnimationEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;
    setLanded((current) => (current === null ? null : { key: current.key, hopping: false }));
  }

  return (
    <div
      ref={layerRef}
      data-companion-fab=""
      data-target={shown?.key}
      data-dragging={dragging ? '' : undefined}
      data-resizing={resizing ? '' : undefined}
      data-landing={landed?.hopping ? '' : undefined}
      data-tracking={tracking ? '' : undefined}
      className="companion-fab pointer-events-none fixed inset-0 z-[49] data-[target]:z-[59] md:z-[59]"
      style={{ translate: `${offset.x}px ${offset.y}px`, '--companion-fab-size': `${size}px` } as CSSProperties}
      onTransitionEnd={handleTransitionEnd}
      onAnimationEnd={handleAnimationEnd}
    >
      <DockableFab
        label={label}
        // Her face fills the circle on her own ground, inside the kit's 1px accent rim, as the applications button's logo
        // does. Placed against the button itself (the kit's glyph wrapper stays static), so the kit's 12px rule for a bare
        // svg glyph never reaches her.
        icon={<span className="absolute inset-0 grid place-items-center rounded-full bg-card">{face}</span>}
        position={rest}
        dockRect={dockRect}
        active={active}
        onPress={() => onPress()}
        onDragStart={handleDragStart}
        onPositionChange={handlePositionChange}
        onRectChange={handleRectChange}
      />
    </div>
  );
}

/**
 * The notch, the status bar and the home indicator, in px per edge, as `env(safe-area-inset-*)` says them. CSS alone knows
 * them, so a hidden probe element wears them as padding and the computed style hands them back; where the screen has no
 * notch `env()` falls to its 0px.
 */
function readSafeInsets() {
  const probe = document.createElement('div');
  probe.style.cssText =
    'position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
  document.body.appendChild(probe);
  const style = getComputedStyle(probe);
  const insets = {
    top: parseFloat(style.paddingTop),
    right: parseFloat(style.paddingRight),
    bottom: parseFloat(style.paddingBottom),
    left: parseFloat(style.paddingLeft),
  };
  probe.remove();
  return insets;
}

/**
 * Her disc on the page: what WorkspaceFrame renders after AppSwitcherFab. It reads her rest, the dock, the open state, her
 * presence and her look from the companion's provider, stores the rest a drag leaves her at, hands her rest's box to her
 * look, and toggles the panel; CompanionFabView draws it.
 *
 * THE LABEL is her name and her presence in words, the sentence her face carries as its own accessible name
 * (`presenceWords`); her name is the one he set, the default while the page has not read it. Her face is `CompanionFace`, the
 * binding of the provider to the portrait that the station draws too; this file hands it only what is the disc's own, its size
 * and the look it is drawing (`useFaceLook`).
 *
 * THE LOOK'S PLACE. `useAvatarTarget` picks the anchor and measures it; `avatarPlacement` says where beside it she stands,
 * clamped inside the window's safe area. Both depend on the window's size, which the placement reads, so the size is
 * subscribed to only while a look holds her: a resize with no look standing moves nothing here. The cell in the rail is told
 * that a look holds her (`setFabAway`) so it keeps her place marked while she is out.
 */
export function CompanionFab() {
  const { t } = useTranslation();
  const { picture, open, setOpen, fabPosition, moveFab, dockRect, setFabAway } = useCompanion();
  const presence = useCompanionPresence();
  const size = useCompanionSize(presence);
  const name = picture?.settings.name ?? t('companion.defaultName', { defaultValue: 'Kaylee' });

  // Her rest's box, as the view reports it: `useAvatarTarget` skips an anchor she already stands on. State because the
  // look is chosen from it, and the view is the only one that knows where the kit placed her.
  const [restRect, setRestRect] = useState<DOMRect | null>(null);
  const look = useAvatarTarget(presence, restRect);
  const holding = look !== null;
  // The look her disc is drawing, as it reports it. State because the disc's glide ends inside the view and a drag sets the look aside there:
  // her face turns toward the anchor only while the disc draws it, and from where she stands only once she has landed.
  const [drawn, setDrawn] = useState<CompanionFabLookDrawn | null>(null);
  const reducedMotion = useReducedMotion();

  const viewportWidth = useSyncExternalStore(holding ? listenToResize : listenToNothing, readViewportWidth);
  const viewportHeight = useSyncExternalStore(holding ? listenToResize : listenToNothing, readViewportHeight);
  // The window as the placement reads it: its size and its safe-area insets, taken once per hold and again only when the
  // window's size changes (an orientation turn moves the insets). The insets' read builds and removes a node, so a
  // re-measure of the same look (a scroll frame) must not repeat it.
  const viewport = useMemo(
    () => (holding ? { width: viewportWidth, height: viewportHeight, safe: readSafeInsets() } : null),
    [holding, viewportWidth, viewportHeight],
  );
  const target = useMemo<CompanionFabTarget | null>(() => {
    if (look === null || viewport === null) return null;
    return { key: look.key, ...avatarPlacement(look.rect, size, viewport) };
  }, [look, viewport, size]);

  // Under reduced motion she jumps: no glide ends and the view never lands, so a drawn look counts as landed at once.
  const faceLook = look !== null && drawn !== null && drawn.key === look.key ? { rect: look.rect, landed: drawn.landed || reducedMotion } : null;
  const lookOffset = useFaceLook({ anchor: faceLook?.rect ?? null, rest: restRect, target, size, landed: faceLook?.landed ?? false });

  useEffect(() => {
    setFabAway(holding);
    // Gone, she is no longer out on a look: the cell must not keep marking a place nobody left.
    return () => setFabAway(false);
  }, [holding, setFabAway]);

  return (
    <CompanionFabView
      label={presenceWords(t, name, presence)}
      face={<CompanionFace size={size - FACE_RIM_PX} look={lookOffset} />}
      size={size}
      position={fabPosition}
      dockRect={dockRect}
      active={open}
      target={target}
      onPress={() => setOpen(!open)}
      onPositionChange={moveFab}
      onRestChange={setRestRect}
      onLookDrawn={setDrawn}
    />
  );
}
