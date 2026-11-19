import { useCallback, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

import { cn } from '@/shared/utils';

/** One thing a ring can be set to: the value the app stores and the name the reader knows it by. */
export type CoreRingStop = { value: string; label: string };

/** One ring round the core: what it sets, every stop on it, the stop it is set to, and what a new stop is told to. */
export type CoreRing = {
  id: string;
  /** What the ring sets, in a word ("Model"): its spoken name. */
  label: string;
  stops: CoreRingStop[];
  value: string;
  onSelect: (value: string) => void;
  /**
   * Whether the stops are a scale, each more than the one before (an effort). A scale is lit as far as it is set. A ring whose stops are
   * only different things (a model) has no "further", so it is lit whole, in its chat's colour.
   */
  scale: boolean;
};

const TAU = Math.PI * 2;

/** Where each ring runs, as a share of the disc's radius: a lone ring, and two with the first inside. */
const RING_SHARE: Record<number, readonly number[]> = { 1: [0.66], 2: [0.56, 0.8] };

/** A press that moved less than this, in px, is a press on a mark and not a turn. */
const TURN_SLOP = 4;

/** The least time between two steps of the wheel, in ms: one notch is one stop. */
const WHEEL_GAP_MS = 110;

/** `value` wrapped into 0..n. */
const mod = (value: number, n: number) => ((value % n) + n) % n;

/** The turn nearest `from` that brings stop `index` to the pointer: a ring goes round the short way. */
function nearestTurn(from: number, index: number, count: number): number {
  const base = Math.round(from);
  let delta = mod(index - base, count);
  if (delta > count / 2) delta -= count;
  return base + delta;
}

/** An angle wrapped into -pi..pi. */
function wrapAngle(angle: number): number {
  return mod(angle + Math.PI, TAU) - Math.PI;
}

type RingDialProps = {
  ring: CoreRing;
  /** The ring's radius in px, in a drawing whose middle is 0,0. */
  radius: number;
  /** A stop that faces the pointer while the ring is being turned, before it is let go; null once it is let go. */
  onPreview: (ringId: string, value: string | null) => void;
};

/**
 * ONE RING. Its marks are its stops, evenly round it; the stop it is set to is the mark at twelve, where its plate stands. A scale is lit
 * as far as it is set, from its first stop round to twelve; a ring of different things is lit whole.
 *
 * FOUR WAYS TO TURN IT, each ending on a stop: drag it round, press a mark (it comes to the pointer the short way), roll the wheel over it
 * (one notch, one stop), or with it focused the arrow keys, Home and End. A drag tells its stop when it is let go, so a turn past three
 * models sets one; the others tell each stop as they reach it. While a drag is under way the stop under the pointer is the ring's
 * `onPreview`, so the core in the middle can wear it before it is chosen.
 *
 * It is a slider to a reader that asks: its name is what it sets and its value is the stop's name. Each mark carries `data-ring-stop`, the
 * stop's own value, so a script can press one.
 */
function RingDial({ ring, radius, onPreview }: RingDialProps) {
  const count = Math.max(1, ring.stops.length);
  const step = TAU / count;
  const chosen = Math.max(0, ring.stops.findIndex((stop) => stop.value === ring.value));

  // How far the ring is turned, in stops: stop `turn` (wrapped) is under the pointer. Unwrapped, so a ring turned past its last stop keeps
  // going the same way round instead of spinning back.
  const [turn, setTurn] = useState(chosen);
  // The same figure for the handlers, which run between renders: a drag reads where the ring is now, not where it was drawn last.
  const turnRef = useRef(chosen);
  // Whether a pointer holds the ring: while it does the ring follows the hand with no easing, and the stop is not told yet.
  const [held, setHeld] = useState(false);
  // The press under way: where it began, the pointer's last angle, and whether it has turned the ring. A ref, read only by the handlers.
  const press = useRef<{ x: number; y: number; angle: number; turned: boolean; stop: number | null } | null>(null);
  // When the wheel last stepped the ring, so one notch is one stop.
  const wheeledAt = useRef(0);
  const groupRef = useRef<SVGGElement>(null);

  // The app set the ring from elsewhere (a new chat, the catalog arriving): it turns to that stop, the short way.
  useEffect(() => {
    if (press.current !== null || mod(Math.round(turnRef.current), count) === chosen) return;
    turnRef.current = nearestTurn(turnRef.current, chosen, count);
    setTurn(turnRef.current);
  }, [chosen, count]);

  const facing = mod(Math.round(turn), count);

  const settle = useCallback((next: number) => {
    turnRef.current = next;
    setTurn(next);
    const stop = ring.stops[mod(next, count)];
    if (stop && stop.value !== ring.value) ring.onSelect(stop.value);
  }, [count, ring]);

  /** The pointer's angle round the ring's middle, clockwise from twelve. */
  const angleOf = (event: { clientX: number; clientY: number }): number => {
    const box = groupRef.current?.ownerSVGElement?.getBoundingClientRect();
    if (!box) return 0;
    return Math.atan2(event.clientX - (box.left + box.width / 2), -(event.clientY - (box.top + box.height / 2)));
  };

  const onPointerDown = (event: ReactPointerEvent<SVGGElement>) => {
    if (event.button !== 0) return;
    const mark = (event.target as Element).getAttribute('data-ring-index');
    press.current = { x: event.clientX, y: event.clientY, angle: angleOf(event), turned: false, stop: mark === null ? null : Number(mark) };
    event.currentTarget.setPointerCapture(event.pointerId);
    setHeld(true);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGGElement>) => {
    const current = press.current;
    if (current === null) return;
    if (!current.turned && Math.hypot(event.clientX - current.x, event.clientY - current.y) < TURN_SLOP) return;
    current.turned = true;
    const angle = angleOf(event);
    const moved = wrapAngle(angle - current.angle);
    current.angle = angle;
    turnRef.current -= moved / step;
    setTurn(turnRef.current);
    const stop = ring.stops[mod(Math.round(turnRef.current), count)];
    if (stop) onPreview(ring.id, stop.value);
  };

  const onPointerUp = (event: ReactPointerEvent<SVGGElement>) => {
    const current = press.current;
    if (current === null) return;
    press.current = null;
    setHeld(false);
    onPreview(ring.id, null);
    const at = turnRef.current;
    if (current.turned) {
      settle(Math.round(at));
      return;
    }
    // A press that did not turn the ring: the mark pressed comes to the pointer, or the stop nearest where the band was pressed.
    const pressed = current.stop ?? mod(Math.round(at + wrapAngle(angleOf(event)) / step), count);
    settle(nearestTurn(at, pressed, count));
  };

  const onPointerCancel = () => {
    if (press.current === null) return;
    press.current = null;
    setHeld(false);
    onPreview(ring.id, null);
    turnRef.current = nearestTurn(turnRef.current, chosen, count);
    setTurn(turnRef.current);
  };

  const onKeyDown = (event: ReactKeyboardEvent<SVGGElement>) => {
    const base = Math.round(turnRef.current);
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = base + 1;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = base - 1;
    else if (event.key === 'Home') next = nearestTurn(base, 0, count);
    else if (event.key === 'End') next = nearestTurn(base, count - 1, count);
    if (next === null) return;
    event.preventDefault();
    settle(next);
  };

  // The wheel, heard without `passive` so the page under the ring does not scroll with it.
  useEffect(() => {
    const group = groupRef.current;
    if (!group) return undefined;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const now = performance.now();
      if (now - wheeledAt.current < WHEEL_GAP_MS || event.deltaY === 0) return;
      wheeledAt.current = now;
      settle(Math.round(turnRef.current) + (event.deltaY > 0 ? 1 : -1));
    };
    group.addEventListener('wheel', onWheel, { passive: false });
    return () => group.removeEventListener('wheel', onWheel);
  }, [settle]);

  const length = TAU * radius;
  const lit = ring.scale ? ((facing + 1) / count) * length : length;
  const stepDeg = 360 / count;

  return (
    <g
      ref={groupRef}
      role="slider"
      tabIndex={0}
      aria-label={ring.label}
      aria-orientation="horizontal"
      aria-valuemin={1}
      aria-valuemax={count}
      aria-valuenow={facing + 1}
      aria-valuetext={ring.stops[facing]?.label ?? ''}
      data-chat-ring={ring.id}
      data-ring-value={ring.stops[facing]?.value ?? ''}
      data-ring-held={held || undefined}
      className="core-ring"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={onKeyDown}
    >
      <g className={cn('core-ring__turn', held && 'core-ring__turn--held')} style={{ transform: `rotate(${-turn * stepDeg}deg)` }}>
        {/* What a pointer takes hold of: the ring's band, wider than its line. */}
        <circle className="core-ring__band" r={radius} />
        <circle className="core-ring__track" r={radius} />
        {/* A scale is lit as far as it is set: from the mark before its first stop round to the stop at twelve. */}
        <circle
          className="core-ring__lit"
          r={radius}
          strokeDasharray={`${lit} ${length}`}
          transform={`rotate(${-90 - stepDeg})`}
        />
        {ring.stops.map((stop, index) => {
          const at = index === facing;
          return (
            <g key={stop.value} transform={`rotate(${index * stepDeg})`}>
              <line className={cn('core-ring__mark', at && 'core-ring__mark--at')} y1={-(radius - (at ? 5 : 0))} y2={-(radius + (at ? 11 : 7))} />
              <circle className="core-ring__stop" data-ring-stop={stop.value} data-ring-index={index} cy={-radius} r={13}>
                <title>{stop.label}</title>
              </circle>
            </g>
          );
        })}
      </g>
    </g>
  );
}

type CoreRingsProps = {
  /** The rings, the innermost first; one or two. */
  rings: CoreRing[];
  /** The side of the square they are drawn in, in px. */
  size: number;
  /** The stop under a ring's pointer while that ring is being turned; null once it is let go. */
  onPreview: (ringId: string, value: string | null) => void;
};

/**
 * THE FLAT RINGS ROUND A CHAT'S CORE: what the chat is set to, as things to turn. One ring for each setting (`RingDial`), the first the
 * closest in. At twelve on each ring stands a small plate with the name of the stop that is there: it is
 * the ring's pointer and its reading at once, so both settings can be read without turning anything. The ring turns under it.
 *
 * It draws the rings and nothing else: the core in the middle, the disc under them and where the whole thing stands are `ChatCore`'s, the
 * only component that draws it.
 */
export function CoreRings({ rings, size, onPreview }: CoreRingsProps) {
  const half = size / 2;
  const shares = RING_SHARE[Math.min(2, Math.max(1, rings.length))];
  // The stop under each ring's pointer while that ring is being turned, by ring: its plate names it before it is chosen.
  const [facing, setFacing] = useState<Record<string, string | null>>({});
  const preview = useCallback((ringId: string, value: string | null) => {
    setFacing((current) => (current[ringId] === value ? current : { ...current, [ringId]: value }));
    onPreview(ringId, value);
  }, [onPreview]);

  return (
    <div className="core-rings" style={{ width: size, height: size }}>
      <svg viewBox={`${-half} ${-half} ${size} ${size}`} width={size} height={size} className="core-rings__drawing">
        {rings.slice(0, 2).map((ring, index) => (
          <RingDial key={ring.id} ring={ring} radius={shares[index] * half} onPreview={preview} />
        ))}
      </svg>
      {rings.slice(0, 2).map((ring, index) => {
        const shown = facing[ring.id] ?? ring.value;
        const stop = ring.stops.find((candidate) => candidate.value === shown);
        return (
          <span
            key={ring.id}
            aria-hidden="true"
            data-chat-ring-plate={ring.id}
            data-turning={facing[ring.id] != null || undefined}
            className="core-rings__plate"
            style={{ top: half - shares[index] * half }}
          >
            {stop?.label ?? shown}
          </span>
        );
      })}
    </div>
  );
}
