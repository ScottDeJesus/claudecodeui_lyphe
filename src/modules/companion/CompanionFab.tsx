import { AudioLines } from 'lucide-react';
import { useRef, useState, useSyncExternalStore } from 'react';
import type { AnimationEvent, ReactNode, TransitionEvent } from 'react';
import { useTranslation } from 'react-i18next';

import '@/modules/companion/CompanionFab.css';
import { FAB_CATCH_PX, FAB_SIZE_PX } from '@/shared/constants';
import { DockableFab } from '@/shared/ui';
import type { DockableFabPosition } from '@/shared/ui';

/** A point in viewport px: a disc's top-left. */
type FabPoint = { x: number; y: number };

/** Where she is drawn while she looks at something: the disc's top-left in viewport px, keyed by the anchor it stands beside. */
type CompanionFabTarget = { key: string; left: number; top: number };

/** Her face's square: the disc less its 1px rim on either side, so the face fills the circle inside the kit's accent rim. */
const FACE_PX = FAB_SIZE_PX - 2;

/**
 * Her own corner on a phone, as the inset from the window's bottom-right corner to the disc's top-left: on the applications
 * button's line, one catch to its left. The applications button's phone default stands at (72, 112)
 * (`FAB_DEFAULT_INSET_X`/`_Y`, app-switcher's appSwitcherStorage.ts), so the two discs share a row and their 44px catches
 * meet edge to edge without overlapping; she also clears the kit's own resting corner, where the applications button sits
 * when its record is docked and the rail is tucked away.
 *
 * WHAT SHE COVERS THERE, measured at 390x844 on a chat: the right part of the composer's first line, beside the
 * applications button, which already covers the line's end — the same trade the house made for that button, and
 * nothing of the conversation.
 *
 * WHY NOT ABOVE IT, where the design first drew her: one catch up is the conversation's newest lines (the last reply's
 * time and menu) and the lane a thumb starts its scroll in, and a scroll that starts on a catch drags the disc
 * (`touch-action: none`) — the house keeps a FAB's catch off the conversation's scroll for exactly that
 * (appSwitcherStorage.ts, FAB_DEFAULT_INSET_X). Nor high in that column under the header: the Files view's folder chips
 * and the Git view's tabs stand there, and a press meant for them would open her panel.
 */
const CORNER_INSET: FabPoint = { x: 72 + FAB_CATCH_PX, y: 112 };

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
  /** Her face, drawn `FACE_PX` square. The disc frames it on her own ground, inside the kit's accent rim. */
  face: ReactNode;
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
 * A DRAG CANCELS ANY MOTION. From the first move the offset drops at once, with no glide to trail the finger, and the
 * look in hand is set aside until another begins, so the drop is where she stays. The drop sets her new rest.
 *
 * STACKING. One rung under the applications button's 60 in the workspace shell's stacking context: over every
 * application (40), the floating chat and her own desktop panel (45) — the disc is how that panel closes — and the
 * sidebar's drawer and rail (50), so she docks over the drawer's rail on a phone. Under the applications button and the
 * radial it fans out (60), which stay on top wherever the two meet. Below lg her panel is a sheet at 61 that covers both
 * discs and carries its own close.
 */
export function CompanionFabView({ label, face, position, dockRect, active, target, onPress, onPositionChange, onRestChange }: CompanionFabViewProps) {
  const layerRef = useRef<HTMLDivElement>(null);

  // Docked with nowhere to dock — the rail tucked away — she rests in her corner, which follows the window's size.
  const inCorner = position.docked && dockRect === null;
  const listen = inCorner ? listenToResize : listenToNothing;
  const viewportWidth = useSyncExternalStore(listen, readViewportWidth);
  const viewportHeight = useSyncExternalStore(listen, readViewportHeight);
  const rest: DockableFabPosition = inCorner
    ? { docked: false, x: viewportWidth - CORNER_INSET.x, y: viewportHeight - CORNER_INSET.y }
    : position;

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

  function handlePositionChange(next: DockableFabPosition) {
    setDragging(false);
    onPositionChange(next);
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
      data-landing={landed?.hopping ? '' : undefined}
      data-tracking={tracking ? '' : undefined}
      className="companion-fab pointer-events-none fixed inset-0 z-[59]"
      style={{ translate: `${offset.x}px ${offset.y}px` }}
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
 * Her disc on the page: what WorkspaceFrame renders after AppSwitcherFab. It reads her rest, the dock, the open state, her
 * presence and her look from the companion's provider, stores the rest a drag leaves her at, hands her rest's box to her
 * look, and toggles the panel; CompanionFabView draws it.
 */
export function CompanionFab() {
  const { t } = useTranslation();
  // FILL(fill): position store — her rest from the companion context, kept in localStorage under `companion-fab`
  const position: DockableFabPosition = { docked: true };
  // FILL(fill): dock rect — the rect CompanionDock registers through the context's `registerDock`, believed only while it is on screen
  const dockRect: DOMRect | null = null;
  // FILL(fill): active — her panel is open, `useCompanion().open`
  const active = false;
  // FILL(fill): presence label — "Kaylee, " plus `useCompanionPresence()` in words, the words her face says for the same state
  const label = t('companion.avatar.idle', { name: t('companion.defaultName', { defaultValue: 'Kaylee' }), defaultValue: '{{name}}, ready' });
  // FILL(fill): target offset — `useAvatarTarget(presence, buttonRect)` placed by `avatarPlacement(rect, FAB_SIZE_PX, viewport)`: `{ key, left, top }`, or null at rest
  const target: CompanionFabTarget | null = null;

  return (
    <CompanionFabView
      label={label}
      // FILL(fill): icon — <CompanionAvatar presence={presence} level={player.level} size={FACE_PX} />
      face={<AudioLines aria-hidden="true" width={FACE_PX} height={FACE_PX} className="p-1.5 text-accent-ink" strokeWidth={2} />}
      position={position}
      dockRect={dockRect}
      active={active}
      target={target}
      // FILL(fill): press — setOpen(!open), which takes the floor
      onPress={() => {}}
      // FILL(fill): position store — store the rest the drag left her at, under `companion-fab`
      onPositionChange={() => {}}
      // FILL(fill): button rect — her rest's box, held for `useAvatarTarget(presence, buttonRect)`'s fourth in-sight test
      onRestChange={() => {}}
    />
  );
}
