import { ArrowLeft } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import { Badge } from '@/shared/ui/Badge';
import { OWNS_ESCAPE, modalInFrontHoldsEscape } from '@/shared/ui/overlayEscape';
import type { AstrolabePoint } from '@/shared/types';
import { cn, shouldOutsidePressClose } from '@/shared/utils';

/** Where the plate stands from its mark: beside it, over or under it, or a sheet at the foot where the room is too narrow. */
type OpeningSide = 'left' | 'right' | 'above' | 'below';
type OpeningPlace = { side: OpeningSide; x: number; y: number; w: number; h: number } | { side: 'sheet' };

/** Under this much room the plate is a sheet at the foot (the design system's rule). */
const SHEET_UNDER_PX = 560;
/** The plate's distance from its mark, and the air it keeps from the room's edges, in px. */
const GAP = 40;
const PAD = 12;
/** How many frames it waits for a mark not drawn yet before it stands as a sheet at the foot. */
const MARK_WAIT_FRAMES = 12;

type OpeningProps = {
  /** Whether it is open. It never opens itself: a click on a mark opens it. */
  open: boolean;
  /** The mark it hangs from, in client coordinates, or a function that answers it each frame (a mark on a turning ring). */
  anchor: AstrolabePoint | (() => AstrolabePoint | null) | null;
  /** Folds it back: its back arrow, Escape, or a press anywhere else. */
  onClose: () => void;
  /** Its back arrow's name for assistive tech and its title. */
  backLabel: string;
  /** What it is about, as a caption: "To Do · Bug". */
  source: string;
  /** Its title: a name, or the field a name is typed in. */
  title?: ReactNode;
  /**
   * Its name, for assistive tech and for a script, where its title is not words (a field the name is typed in): said as its
   * label and set in a heading only a screen reader reads, as a dialog's title is. Absent, a title in words is its name, else its
   * source.
   */
  name?: string;
  /** A word of state beside the title, in one of the tones. */
  status?: { word: string; tone: 'info' | 'positive' | 'warn' | 'danger' | 'neutral' };
  /** Its width in px, where the room allows: the design system's 320 when absent. */
  width?: number;
  /** The side it opens on; absent, whichever has room. */
  side?: OpeningSide;
  /** The object it came from, in client coordinates: where the room allows, it stands clear of it, so the object stays whole. */
  avoid?: () => { left: number; right: number } | null;
  /** Marks on the plate, for the page's scripts and styles. */
  marks?: Record<`data-${string}`, string>;
  children: ReactNode;
};

/**
 * THE DESIGN SYSTEM'S OPENING: what a deliberate click opened, hung from the mark it came out of. It is the one place where words,
 * lists and history live. It unfolds on the lock spring on whichever side of its mark has room, joined to the mark by an accent
 * hairline that follows the mark while its hoop turns; with less than 560 px of room it is a sheet at the foot. One at a time.
 *
 * IT FOLDS BACK on its back arrow, on Escape and on a press anywhere else, except on a press inside anything it put up itself (a
 * select's list, a dialog it opened: they are its own in the React tree even when portalled), and on a press on the object it hangs
 * from or in the floating chat (`data-ast-keeps-opening`, `shouldOutsidePressClose`): the object turns to another thing without closing it first. It owns Escape while it is open
 * (`OWNS_ESCAPE`) and stands down while a dialog or a panel of its own is in front of it. Focus moves into it when it opens; giving
 * it back to the object is the opener's (`onClose`).
 *
 * It is drawn inside the place it belongs to, which must be positioned: it covers that place and measures its room there.
 *
 * Used by the kanban module's bug board (`KanbanPanel`, `KanbanCardDrawer`, `ProposedFeatures`: a bug, a proposal, the board and a run's
 * further things), the cerberus module's `CerberusPanel` (a machine, the fleet and a run's further machines) and project-workspace's
 * `PlaceTrail`, and the rnd module's `CandidateOpening` (a candidate, hung from its row).
 */
export function Opening({ open, anchor, onClose, backLabel, source, title, name, status, width, side, avoid, marks, children }: OpeningProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const plateRef = useRef<HTMLElement>(null);
  const lineRef = useRef<SVGLineElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  // The last press React delivered to the plate's own tree (a portalled select or dialog of its own included): not outside it.
  const pressInside = useRef<Event | null>(null);
  // Where the plate stands, measured from its own box once drawn; null until then, while it is drawn hidden.
  const [place, setPlace] = useState<OpeningPlace | null>(null);
  const anchorRef = useRef(anchor);
  const closeRef = useRef(onClose);
  useEffect(() => {
    anchorRef.current = anchor;
    closeRef.current = onClose;
  });

  /** The mark in the room's own coordinates, with the room's size. */
  const anchorInRoom = () => {
    const given = anchorRef.current;
    const point = typeof given === 'function' ? given() : given;
    const room = rootRef.current?.getBoundingClientRect();
    if (!point || !room) return null;
    return { x: point.x - room.left, y: point.y - room.top, W: room.width, H: room.height };
  };

  // How many frames it has waited for its mark to be drawn: a thing just made has no mark until the rings' next frame.
  const [waited, setWaited] = useState(0);
  // The plate's own height, observed: a plate that grows (its detail landing, a field opening) is placed again on the same side.
  const [height, setHeight] = useState(0);
  // The side chosen as it opened, kept while it stays open, so a plate that grows moves along its side and never jumps across.
  const sideRef = useRef<OpeningSide | 'sheet' | null>(null);

  useEffect(() => {
    const plate = plateRef.current;
    if (!open || !plate || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(() => setHeight(plate.offsetHeight));
    observer.observe(plate);
    return () => observer.disconnect();
  }, [open]);

  // Its place: on the side with room, or a sheet at the foot; clear of the object it came from where the room allows.
  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      setWaited(0);
      sideRef.current = null;
      return undefined;
    }
    const plate = plateRef.current;
    const at = anchorInRoom();
    const room = rootRef.current?.getBoundingClientRect();
    if (!plate || !room) return undefined;
    if (!at && room.width >= SHEET_UNDER_PX && waited < MARK_WAIT_FRAMES && sideRef.current === null) {
      const frame = requestAnimationFrame(() => setWaited((count) => count + 1));
      return () => cancelAnimationFrame(frame);
    }
    if (!at || at.W < SHEET_UNDER_PX || sideRef.current === 'sheet') {
      sideRef.current = 'sheet';
      setPlace((current) => (current?.side === 'sheet' ? current : { side: 'sheet' }));
      return undefined;
    }
    const w = plate.offsetWidth;
    const h = plate.offsetHeight;
    let chosen: OpeningSide = sideRef.current ?? side ?? (at.x < at.W / 2 ? 'right' : 'left');
    if (sideRef.current === null) {
      if (chosen === 'right' && at.x + GAP + w > at.W - PAD) chosen = at.x - GAP - w >= PAD ? 'left' : 'below';
      if (chosen === 'left' && at.x - GAP - w < PAD) chosen = at.x + GAP + w <= at.W - PAD ? 'right' : 'below';
      if (chosen === 'below' && at.y + GAP + h > at.H - PAD) chosen = 'above';
      sideRef.current = chosen;
    }
    const clampTo = (value: number, low: number, high: number) => Math.min(Math.max(value, low), Math.max(low, high));
    const clear = avoid?.() ?? null;
    let next: OpeningPlace;
    if (chosen === 'right' || chosen === 'left') {
      let x = chosen === 'right' ? at.x + GAP : at.x - GAP - w;
      // Where there is room, it stands clear of the object it came from, so the object stays whole; where there is not, it
      // stands against the room's edge, covering as little of the object as it can.
      if (clear) {
        const right = clear.right - room.left;
        const left = clear.left - room.left;
        if (chosen === 'right') x = Math.max(x, Math.min(at.W - w - PAD, right + 16));
        if (chosen === 'left') x = Math.min(x, Math.max(PAD, left - 16 - w));
      }
      next = { side: chosen, x: clampTo(x, PAD, at.W - w - PAD), y: clampTo(at.y - Math.min(h * 0.3, 56), PAD, at.H - h - PAD), w, h };
    } else {
      next = { side: chosen, x: clampTo(at.x - w / 2, PAD, at.W - w - PAD), y: chosen === 'below' ? Math.min(at.y + GAP, Math.max(PAD, at.H - h - PAD)) : Math.max(PAD, at.y - GAP - h), w, h };
    }
    setPlace((current) => (current !== null && current.side === next.side && 'x' in current && 'x' in next && current.x === next.x && current.y === next.y && current.h === next.h ? current : next));
    return undefined;
    // Placed as it opens (and again while it waits for its mark, and as it grows), on the side it first took.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, side, waited, height]);

  // The leader follows the mark while the instrument drifts.
  useEffect(() => {
    if (!open || place === null || place.side === 'sheet') return undefined;
    let raf = 0;
    let alive = true;
    const draw = () => {
      if (!alive) return;
      raf = requestAnimationFrame(draw);
      const line = lineRef.current;
      const dot = dotRef.current;
      const at = anchorInRoom();
      if (!line || !dot || !at) return;
      const clampTo = (value: number, low: number, high: number) => Math.min(Math.max(value, low), high);
      const ex = place.side === 'right' ? place.x : place.side === 'left' ? place.x + place.w : clampTo(at.x, place.x + 12, place.x + place.w - 12);
      const ey = place.side === 'below' ? place.y : place.side === 'above' ? place.y + place.h : clampTo(at.y, place.y + 14, place.y + place.h - 14);
      line.setAttribute('x1', at.x.toFixed(1));
      line.setAttribute('y1', at.y.toFixed(1));
      line.setAttribute('x2', ex.toFixed(1));
      line.setAttribute('y2', ey.toFixed(1));
      dot.setAttribute('cx', at.x.toFixed(1));
      dot.setAttribute('cy', at.y.toFixed(1));
    };
    draw();
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, place]);

  // Open, it folds back on Escape (unless a dialog or a panel of its own is in front of it) and on a press outside it.
  useEffect(() => {
    if (!open) return undefined;
    const doc = rootRef.current?.ownerDocument ?? document;
    const view = doc.defaultView ?? window;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (modalInFrontHoldsEscape(plateRef.current, doc)) return;
      event.preventDefault();
      closeRef.current();
    };
    const onDown = (event: PointerEvent) => {
      if (pressInside.current === event) return;
      if (!shouldOutsidePressClose(event, [plateRef.current])) return;
      closeRef.current();
    };
    view.addEventListener('keydown', onKey, { capture: true });
    // A tick later, so the press that opened it is not the press that closes it.
    const timer = view.setTimeout(() => doc.addEventListener('pointerdown', onDown), 0);
    return () => {
      view.clearTimeout(timer);
      view.removeEventListener('keydown', onKey, { capture: true });
      doc.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  // The focus goes into it once it stands where it belongs: a plate drawn hidden while it is placed takes no focus.
  const shown = open && place !== null;
  useEffect(() => {
    if (shown) plateRef.current?.focus({ preventScroll: true });
  }, [shown]);

  if (!open) return null;
  const sheet = place?.side === 'sheet';
  const plateStyle: CSSProperties = place === null || sheet
    ? (width && !sheet ? { width } : {})
    : { left: place.x, top: place.y, ...(width ? { width } : {}) };

  return (
    <div ref={rootRef} className="ast-opening" data-side={place?.side ?? 'right'} data-ready={place === null ? 'false' : 'true'}>
      {!sheet && (
        <svg className="ast-opening-leader" aria-hidden="true">
          <line ref={lineRef} />
          <circle ref={dotRef} r={5} />
        </svg>
      )}
      <section
        ref={plateRef}
        role="dialog"
        aria-label={name ?? (typeof title === 'string' ? title : source)}
        tabIndex={-1}
        {...OWNS_ESCAPE}
        {...marks}
        className="ast-opening-plate"
        style={plateStyle}
        onPointerDownCapture={(event) => { pressInside.current = event.nativeEvent; }}
      >
        <header className="ast-opening-head">
          <button type="button" className="ast-opening-close" aria-label={backLabel} title={backLabel} onClick={() => onClose()}>
            <ArrowLeft aria-hidden="true" className="size-4" />
          </button>
          <span className="ast-opening-source">{source}</span>
          {status && <Badge tone={status.tone} className="flex-none">{status.word}</Badge>}
        </header>
        {name !== undefined && typeof title !== 'string' && <h3 className="sr-only">{name}</h3>}
        {title !== undefined && title !== null && (typeof title === 'string' ? <h3 className="ast-opening-title">{title}</h3> : title)}
        <div className={cn('ast-opening-body')}>{children}</div>
      </section>
    </div>
  );
}
