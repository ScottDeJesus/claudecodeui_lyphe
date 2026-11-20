import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';

import {
  angleAt, bringRing, clamp, createRingsEngine, drawGauges, drawHover, drawPointer, drawRing, findItem, fitCanvas, HALF_TURN, isFacing,
  itemAt, itemOf, itemState, jumpRing, keyBase, liveRings, markPoint, RING_STATE_WORD, RING_VMAX, ringAt, ringHeading, ringIndex, ringStep, releaseRing,
  stepPalette, syncRings, wrapPi,
} from '@/shared/ui/ringsEngine';
import type { RingsEngine, RingState } from '@/shared/ui/ringsEngine';
import type { AstrolabePoint, AstrolabeRing, AstrolabeRingGauge, AstrolabeRingItem, AstrolabeRingsHandle } from '@/shared/types';
import { cn } from '@/shared/utils';

type RingsProps = {
  /** The rings, inside out, one to five: sets of two to twenty-four things each. A ring with nothing on it is not given. */
  rings: AstrolabeRing[];
  /** What the instrument is, for assistive tech: the group's name. */
  label: string;
  /** The core in the middle, drawn at the side of the square it is handed, in px. */
  core?: (size: number) => ReactNode;
  /** A press on the core, and its name for assistive tech. */
  onCore?: () => void;
  coreLabel?: string;
  /** One measure worn round the core, or two, the inner first. */
  gauge?: AstrolabeRingGauge[];
  /** A press on a measure: its place on the page, and which (0 the inner). Null from the keyboard. */
  onGauge?: (point: AstrolabePoint | null, index: number) => void;
  /** Another thing has locked at a ring's pointer. */
  onChange?: (item: AstrolabeRingItem, ring: AstrolabeRing) => void;
  /** The thing facing you was pressed (or Enter on its ring): it opens, from the point given. */
  onOpen?: (item: AstrolabeRingItem, ring: AstrolabeRing, point: AstrolabePoint | null) => void;
  /** Holds every ring still: an Opening hangs from one of its marks. */
  hold?: boolean;
  /** Whether the rings drift when left alone. */
  drift?: boolean;
  /**
   * A picture only: no slider, no meter and no press of its own, and nothing for assistive tech (the caller's own press round it
   * says what it is). The instrument docked inside a button is one.
   */
  decorative?: boolean;
  className?: string;
};

/** How far from a ring's line a pointer still takes hold of it, in px: a mouse, and a finger. */
const GRAB_MOUSE = 14;
const GRAB_TOUCH = 30;

/**
 * THE DESIGN SYSTEM'S RINGS: sets of things you turn through, as rings round a core. Each ring is a way in, a measure and a sign
 * at once: the mark at the pointer is where you are, each thing's span lights with its progress, and the way the span moves says
 * what it is doing (`ringsEngine.ts` draws it, line for line the design system's own). No words until you touch it: a plate
 * beside the pointer names what faces you while a ring is in use, and under a mouse the mark you point at names itself.
 *
 * ITS MECHANICS ARE A PHYSICAL THING'S. Drag a ring and the mark under your finger stays under it; flick it and it glides, then
 * the nearest mark catches it on the lock spring. Tap a mark and it comes round; tap the one facing you and it opens (`onOpen`).
 * The wheel turns the ring under the cursor. Rings drift when left alone and hold still the moment one is touched, or while
 * `hold` says an Opening hangs from one. Each ring is a slider for the keyboard: arrows turn it a mark at a time, Home and End go
 * to the first and last, Enter opens what faces you.
 *
 * Its ref answers where a thing's mark stands (`pointOf`, for an Opening to hang from) and its direction from the core
 * (`azimuthOf`, for a core that reads from it or writes to it).
 *
 * Used by the kanban module's bug board (`BugInstrument`), whose lanes are its rings and whose bugs are their marks.
 */
export const Rings = forwardRef<AstrolabeRingsHandle, RingsProps>(function Rings(
  { rings, label, core, onCore, coreLabel, gauge, onGauge, onChange, onOpen, hold = false, drift = true, decorative = false, className },
  ref,
) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<RingsEngine | null>(null);
  const box = useRef({ w: 0, h: 0 });
  // The latest props, read by the frame loop and the hands, which are made once: brought up to date after each render.
  const props = useRef({ rings, gauge, onCore, onGauge, onChange, onOpen, hold, drift });
  useLayoutEffect(() => {
    props.current = { rings, gauge, onCore, onGauge, onChange, onOpen, hold, drift };
  });
  // The side of the square the core is drawn in, in px: measured from the rings' own size, so the core is the rig's.
  const [coreSize, setCoreSize] = useState(0);
  // The thing each ring has locked on, by ring, as the frame loop last said: what each slider's value says.
  const [facing, setFacing] = useState<Record<string, number>>({});

  const engine = () => {
    if (engineRef.current === null) engineRef.current = createRingsEngine();
    return engineRef.current;
  };

  /** Where thing j of a ring stands on the page. */
  const clientPoint = useCallback((r: RingState, j: number): AstrolabePoint | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const at = markPoint(engine(), r, j);
    return { x: rect.left + at.x, y: rect.top + at.y };
  }, []);

  const open = useCallback((r: RingState, j: number) => {
    const item = itemOf(r, j);
    if (item) props.current.onOpen?.(item, r.def, clientPoint(r, j));
  }, [clientPoint]);

  useImperativeHandle(ref, () => ({
    pointOf: (ringId, itemId) => {
      const r = engine().rings.find((ring) => ring.id === ringId);
      if (!r) return null;
      const j = findItem(r.items, itemId);
      return j < 0 ? null : clientPoint(r, j);
    },
    azimuthOf: (ringId, itemId) => {
      const E = engine();
      const r = E.rings.find((ring) => ring.id === ringId);
      const canvas = canvasRef.current;
      if (!r || !canvas) return null;
      const j = findItem(r.items, itemId);
      if (j < 0) return null;
      const at = markPoint(E, r, j);
      return (Math.atan2(E.cy - at.y, at.x - E.cx) * 180) / Math.PI;
    },
  }), [clientPoint]);

  // The box, observed.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    const set = () => {
      const rect = root.getBoundingClientRect();
      box.current = { w: rect.width, h: rect.height };
    };
    set();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(set);
    observer.observe(root);
    return () => observer.disconnect();
  }, []);

  // The frame loop: every frame while on screen, paused offscreen and in a hidden tab.
  useEffect(() => {
    const root = rootRef.current;
    let raf = 0;
    let last = performance.now();
    let visible = true;
    let alive = true;
    let failed = false;
    const io = root && typeof IntersectionObserver !== 'undefined'
      ? new IntersectionObserver((entries) => { visible = entries.some((entry) => entry.isIntersecting); })
      : null;
    if (root && io) io.observe(root);
    const frame = () => {
      if (!alive) return;
      raf = requestAnimationFrame(frame);
      const now = performance.now();
      if (!visible || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, Math.max(0.001, (now - last) / 1000));
      last = now;
      try {
        draw(dt, now);
      } catch (error) {
        if (!failed) {
          failed = true;
          console.error('[Rings]', error);
        }
      }
    };
    const draw = (dt: number, now: number) => {
      const canvas = canvasRef.current;
      const { w: W, h: H } = box.current;
      if (!root || !canvas || !W || !H) return;
      const E = engine();
      const P = stepPalette(E, root, now, dt);
      const given = props.current;
      syncRings(E, given.rings);
      E.started = true;
      const mn = Math.min(W, H);
      E.W = W;
      E.H = H;
      E.cx = W / 2;
      E.cy = H / 2;
      E.Ro = Math.max(14, (mn / 2 - clamp(mn * 0.085, 5, 30)) / 1.08);
      const size = Math.round((2 * E.Ro) / 2.3);
      if (E.core !== size) {
        E.core = size;
        setCoreSize(size);
      }
      const locked = liveRings(E, dt, now, given.hold, given.drift, (r) => {
        const item = r.items[ringIndex(r)];
        if (item && item.id !== r.reported) {
          r.reported = item.id;
          given.onChange?.(item, r.def);
        }
      });
      if (locked) setFacing(Object.fromEntries(E.rings.map((r) => [r.id, r.sel])));
      const dpr = fitCanvas(canvas, W, H);
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const r of E.rings) drawRing(ctx, E, r, false, P);
      for (const r of E.rings) drawRing(ctx, E, r, true, P);
      for (const r of E.rings) drawPointer(ctx, E, r, P);
      drawGauges(ctx, E, P, (given.gauge ?? []).slice(0, 2));
      drawHover(ctx, E, P);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);

  /* ---------------- hands ---------------- */

  const local = (event: { clientX: number; clientY: number }): [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return rect ? [event.clientX - rect.left, event.clientY - rect.top] : [0, 0];
  };

  const setHover = (E: RingsEngine, r: RingState | null, j: number) => {
    for (const ring of E.rings) ring.hover = ring === r;
    E.hover = r ? { ring: r, j } : null;
    const canvas = canvasRef.current;
    if (canvas) canvas.style.cursor = E.nGrabs ? 'grabbing' : r ? 'grab' : (E.overCore && props.current.onCore) || (E.overGauge && props.current.onGauge) ? 'pointer' : '';
  };

  const onDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const E = engine();
    const [x, y] = local(event);
    const touch = event.pointerType === 'touch';
    const r = ringAt(E, x, y, touch ? GRAB_TOUCH : GRAB_MOUSE);
    if (!r) {
      const d = Math.hypot(x - E.cx, y - E.cy);
      const tolerance = touch ? 14 : 8;
      const onGaugeBand = !!props.current.onGauge && E.gaugeR > 0 && d > E.gaugeR - tolerance && d < E.gaugeOut + tolerance;
      E.coreDown = onGaugeBand || d < E.Ro / 2.3
        ? { x, y, t: event.timeStamp, gauge: onGaugeBand, gi: onGaugeBand && E.gaugeOut > E.gaugeR && d > (E.gaugeR + E.gaugeOut) / 2 ? 1 : 0 }
        : null;
      return;
    }
    event.preventDefault();
    try {
      canvasRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // A pointer that cannot be captured still turns the ring while it stays over the canvas.
    }
    // A touch on a spinning ring catches it.
    const moving = r.mode !== 'rest';
    r.mode = 'held';
    r.holder = event.pointerId;
    r.vel = 0;
    r.hist = [[event.timeStamp, r.psi]];
    E.grabs[event.pointerId] = { ring: r, last: angleAt(E, r, x, y), x0: x, y0: y, t0: event.timeStamp, travel: 0, moving, touch };
    E.nGrabs++;
    setHover(E, event.pointerType === 'mouse' ? r : null, 0);
    E.hover = null;
  };

  const onMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const E = engine();
    const [x, y] = local(event);
    const grab = E.grabs[event.pointerId];
    if (!grab) {
      if (event.pointerType !== 'mouse') return;
      const r = ringAt(E, x, y, GRAB_MOUSE);
      const d = Math.hypot(x - E.cx, y - E.cy);
      E.overGauge = !r && E.gaugeR > 0 && d > E.gaugeR - 8 && d < E.gaugeOut + 8 ? (E.gaugeOut > E.gaugeR && d > (E.gaugeR + E.gaugeOut) / 2 ? 2 : 1) : 0;
      E.overCore = !r && !E.overGauge && d < E.Ro / 2.3;
      setHover(E, r, r ? itemAt(E, r, x, y) : 0);
      return;
    }
    const r = grab.ring;
    const a = angleAt(E, r, x, y);
    r.psi += wrapPi(a - grab.last);
    grab.last = a;
    grab.travel = Math.max(grab.travel, Math.hypot(x - grab.x0, y - grab.y0));
    r.hist.push([event.timeStamp, r.psi]);
    while (r.hist.length > 2 && event.timeStamp - r.hist[0][0] > 110) r.hist.shift();
  };

  const onUp = (event: ReactPointerEvent<HTMLCanvasElement>, cancelled: boolean) => {
    const E = engine();
    const grab = E.grabs[event.pointerId];
    if (!grab) {
      const down = E.coreDown;
      E.coreDown = null;
      if (cancelled || !down || event.timeStamp - down.t >= 500) return;
      const [x, y] = local(event);
      if (Math.hypot(x - down.x, y - down.y) >= 10) return;
      if (down.gauge) {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (rect) props.current.onGauge?.({ x: rect.left + E.cx, y: rect.top + E.cy - E.gaugeOut }, down.gi);
      } else props.current.onCore?.();
      return;
    }
    delete E.grabs[event.pointerId];
    E.nGrabs = Math.max(0, E.nGrabs - 1);
    const r = grab.ring;
    r.holder = null;
    try {
      canvasRef.current?.releasePointerCapture(event.pointerId);
    } catch {
      // Already released.
    }
    if (canvasRef.current) canvasRef.current.style.cursor = '';
    if (r.leaving) return;
    // A tap, not a turn: a mark tapped comes round to you; the one already facing you opens.
    if (!cancelled && grab.travel < (grab.touch ? 10 : 5) && event.timeStamp - grab.t0 < 400) {
      if (grab.moving) {
        releaseRing(r, 0);
        return;
      }
      const [x, y] = local(event);
      const j = itemAt(E, r, x, y);
      r.psi = r.hist[0][1];
      if (isFacing(r, j)) {
        r.mode = 'rest';
        r.plateUntil = performance.now() + 1400;
        open(r, j);
      } else bringRing(r, j);
      return;
    }
    let v = 0;
    const hist = r.hist;
    if (hist.length >= 2) {
      const first = hist[0];
      const latest = hist[hist.length - 1];
      const span = latest[0] - first[0];
      if (span > 12 && event.timeStamp - latest[0] < 90) v = (latest[1] - first[1]) / (span / 1000);
    }
    releaseRing(r, clamp(v, -RING_VMAX, RING_VMAX));
  };

  // The wheel turns the ring under the cursor: a listener of its own, because React's is passive and the page must not scroll.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const onWheel = (event: WheelEvent) => {
      const E = engine();
      const [x, y] = local(event);
      const r = ringAt(E, x, y, 16);
      if (!r) return;
      event.preventDefault();
      const px = event.deltaMode === 1 ? event.deltaY * 16 : event.deltaMode === 2 ? event.deltaY * 120 : event.deltaY;
      r.psi -= clamp(px, -240, 240) * 0.0024;
      r.mode = 'wheel';
      r.vel = 0;
      r.wheelUntil = performance.now() + 150;
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>, ringId: string) => {
    const r = engine().rings.find((ring) => ring.id === ringId);
    if (!r) return;
    const base = keyBase(r);
    let step = 0;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') step = 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') step = -1;
    else if (event.key === 'Home') {
      event.preventDefault();
      jumpRing(r, base + wrapPi(HALF_TURN - base));
      return;
    } else if (event.key === 'End') {
      event.preventDefault();
      jumpRing(r, base + wrapPi(HALF_TURN + (r.n - 1) * ringStep(r) - base));
      return;
    } else if (event.key === 'Enter' || event.key === ' ') {
      // What faces you opens; a ring still coming round opens the thing it is coming round to, so a quick Enter after an arrow
      // opens what the arrow chose. Under a hand nothing opens.
      event.preventDefault();
      if (r.mode !== 'held' && r.mode !== 'wheel') open(r, ringHeading(r));
      return;
    } else return;
    event.preventDefault();
    jumpRing(r, base + step * ringStep(r));
  };

  // `at` is the event's own stamp, on the same clock as the frame loop's.
  const setFocus = (ringId: string, on: boolean, at: number) => {
    const r = engine().rings.find((ring) => ring.id === ringId);
    if (!r) return;
    r.focus = on;
    if (!on) r.plateUntil = at + 1400;
  };

  return (
    <div
      ref={rootRef}
      role={decorative ? undefined : 'group'}
      aria-label={decorative ? undefined : label}
      aria-hidden={decorative ? true : undefined}
      data-ast-rings=""
      className={cn('ast-rings', decorative && 'pointer-events-none', className)}
    >
      <div className="ast-rings-core" style={{ width: coreSize, height: coreSize }}>{coreSize > 0 ? core?.(coreSize) : null}</div>
      <canvas
        ref={canvasRef}
        className="ast-rings-canvas"
        aria-hidden="true"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={(event) => onUp(event, false)}
        onPointerCancel={(event) => onUp(event, true)}
        onLostPointerCapture={(event) => onUp(event, true)}
        onPointerLeave={(event) => {
          const E = engine();
          if (event.pointerType === 'mouse' && !E.nGrabs) {
            E.overCore = false;
            E.overGauge = 0;
            setHover(E, null, 0);
          }
        }}
        onContextMenu={(event) => event.preventDefault()}
      />
      {/* Every ring is a slider: arrows turn it a mark at a time, Enter opens what faces you. */}
      {!decorative && rings.slice(0, 5).map((ring) => {
        const locked = facing[ring.id];
        const k = locked !== undefined ? clamp(locked, 0, Math.max(0, ring.items.length - 1)) : Math.max(0, findItem(ring.items, ring.value ?? ring.defaultValue));
        const item = ring.items[k];
        return (
          <div
            key={ring.id}
            role="slider"
            tabIndex={0}
            data-ring={ring.id}
            // The things round it by key, in their order, for a script that turns the ring to one (Home, then that many arrows).
            data-ring-items={ring.items.map((thing) => thing.id).join(' ')}
            className="ast-sr ast-rings-slider"
            aria-label={ring.label}
            aria-orientation="horizontal"
            aria-valuemin={1}
            aria-valuemax={Math.max(1, ring.items.length)}
            aria-valuenow={k + 1}
            aria-valuetext={item ? `${item.label}, ${item.detail || RING_STATE_WORD[itemState(item)]}` : ring.label}
            onFocus={(event) => setFocus(ring.id, true, event.timeStamp)}
            onBlur={(event) => setFocus(ring.id, false, event.timeStamp)}
            onKeyDown={(event) => onKey(event, ring.id)}
          />
        );
      })}
      {!decorative && (gauge ?? []).slice(0, 2).map((measure, index) => (
        <div
          key={`gauge-${index}`}
          role="meter"
          className="ast-sr"
          tabIndex={onGauge ? 0 : undefined}
          aria-label={measure.label}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(clamp(measure.value, 0, 1) * 100)}
          aria-valuetext={measure.detail}
          onKeyDown={(event) => {
            if (onGauge && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              onGauge(null, index);
            }
          }}
        />
      ))}
      {!decorative && onCore && <button type="button" className="ast-sr" onClick={onCore}>{coreLabel}</button>}
    </div>
  );
});
