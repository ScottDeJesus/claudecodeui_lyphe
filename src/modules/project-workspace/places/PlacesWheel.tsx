import '@/modules/project-workspace/places/places.css';

import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import type { ComponentType, CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import { CompanionFace } from '@/modules/companion';
import { PlaceMarkDot } from '@/modules/project-workspace/places/PlaceMarkDot';
import { OUT_OF_REACH } from '@/shared/constants';
import type { Place, PlaceId } from '@/shared/types';
import { Button } from '@/shared/ui';
import { OWNS_ESCAPE } from '@/shared/ui/overlayEscape';

/** Under this much room on either side the wheel is a fan from the foot, in the thumb's reach (the Opening's own sheet rule). */
const FAN_UNDER_PX = 560;

/**
 * Where each place stands on its ring: its slot, the same every time, so the hand learns the angle. The inner ring's five from the
 * top round clockwise, the outer's six likewise.
 */
const SLOT: Record<PlaceId, number> = { home: 0, station: 1, roadmap: 2, bugs: 3, chat: 4, cerberus: 0, inbox: 1, api: 2, universe: 3, schedules: 4, settings: 5 };

/**
 * The bearings of the slots, in degrees clockwise from the top. At a desk the whole circle; on a phone the same places at the same
 * sides, folded into the half above the thumb (Home straight up, the station and the Roadmap to its right, the last chat and Bugs to
 * its left; the outer ring likewise).
 */
const DESK_INNER = [0, 72, 144, 216, 288];
const DESK_OUTER = [30, 90, 150, 210, 270, 330];
const FAN_INNER = [0, 31.2, 62.4, -62.4, -31.2];
const FAN_OUTER = [13, 39, 65, -65, -39, -13];

/** The air between two sectors, in degrees. */
const GAP = 1.2;

type Ring = { r0: number; r1: number; at: number; half: number; mids: readonly number[] };

/** The wheel laid out for the window: its middle, its scale and its two rings, the plate's and the acts' rows, in the window's px. */
type Dial = { fan: boolean; cx: number; cy: number; s: number; inner: Ring; outer: Ring; core: number; plateY: number; actsY: number };

function dialFor(width: number, height: number, withActs: boolean): Dial {
  const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
  if (Math.min(width, height) < FAN_UNDER_PX) {
    // The fan: its middle at the foot, as wide as the window lets its outer ring run without leaving it. Over it, close, the acts,
    // and over them the name of the place pointed at.
    const s = clamp(Math.min((width / 2 - 8) / 236, (height - 190) / 330), 0.6, 1);
    const core = 92 * s;
    const cy = height - 28 - core / 2;
    const actsY = cy - 240 * s - 52;
    return {
      fan: true, cx: width / 2, cy, s, core, actsY, plateY: withActs ? actsY - 34 : cy - 240 * s - 34,
      inner: { r0: 72 * s, r1: 176 * s, at: 126 * s, half: 15.6, mids: FAN_INNER },
      outer: { r0: 186 * s, r1: 240 * s, at: 213 * s, half: 13, mids: FAN_OUTER },
    };
  }
  // The wheel: 600 px across its rim at full size, the plate and the acts under it, the three centred in the window together.
  const s = clamp(Math.min((width - 48) / 600, (height - 150) / 600), 0.5, 1);
  const cy = (height - (600 * s + 94)) / 2 + 300 * s;
  const plateY = cy + 300 * s + 12;
  return {
    fan: false, cx: width / 2, cy, s, core: 150 * s, plateY, actsY: plateY + 38,
    inner: { r0: 98 * s, r1: 214 * s, at: 156 * s, half: 36, mids: DESK_INNER },
    outer: { r0: 226 * s, r1: 288 * s, at: 257 * s, half: 30, mids: DESK_OUTER },
  };
}

/** A point at radius `r` and bearing `a` (degrees clockwise from the top) from the middle. */
function polar(cx: number, cy: number, r: number, a: number): [number, number] {
  const t = (a * Math.PI) / 180;
  return [cx + r * Math.sin(t), cy - r * Math.cos(t)];
}

/** One ring's sector from bearing `a0` to `a1`, between radii `r0` and `r1`. */
function sectorPath(cx: number, cy: number, r0: number, r1: number, a0: number, a1: number): string {
  const at = (r: number, a: number) => polar(cx, cy, r, a).map((v) => v.toFixed(2)).join(' ');
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${at(r1, a0)}A${r1} ${r1} 0 ${big} 1 ${at(r1, a1)}L${at(r0, a1)}A${r0} ${r0} 0 ${big} 0 ${at(r0, a0)}Z`;
}

const subscribeToResize = (onChange: () => void) => {
  window.addEventListener('resize', onChange);
  return () => window.removeEventListener('resize', onChange);
};
const readWidth = () => window.innerWidth;
const readHeight = () => window.innerHeight;

/** The place a point of the window stands on: a sector or a name, each marked with its place. */
function placeAt(x: number, y: number): PlaceId | null {
  return (document.elementFromPoint(x, y)?.closest('[data-place]')?.getAttribute('data-place') as PlaceId | undefined) ?? null;
}

/** An act under the wheel: one of the applications' (the switcher's own list), or New project. */
type WheelAct = { key: string; label: string; icon: ComponentType<{ className?: string }>; run: () => void };

type PlacesWheelProps = {
  /** The places, in the wheel's order (the provider's list). */
  places: Place[];
  /** The acts, a row of presses under the wheel: the applications', then New project; none at the station. */
  acts: WheelAct[];
  /** The middle of the press it came out of, for the hairline that joins it to the wheel; null when a key summoned it. */
  from: { x: number; y: number } | null;
  /** The pointer still down from the press that opened it: letting go over a place goes there; elsewhere, the wheel stays up. */
  held: number | null;
  /** Settling away after it was put away with nothing chosen: out of reach, pressing nothing. */
  leaving: boolean;
  /** Takes it down: at once when a place is chosen (`false`), or settling off when it is put away as it was (`true`, the focus going back where it was). */
  onClose: (restoreFocus: boolean) => void;
};

/**
 * THE WHEEL OF PLACES: the ground dims and the places stand round Kaylee's core, the five visited most on the inner ring and the rest on
 * the outer, each at the same bearing every time, so the hand learns where a place is. EACH PLACE IS ITS GLYPH ALONE, but the last chat,
 * which keeps its title (a speech bubble alone does not say which chat). The place pointed at is named on the plate under the wheel,
 * and only while it is pointed at; the core reads toward it (her reading form, turned to its bearing). The place on screen is drawn
 * raised. What waits at a place is marked on its glyph (`PlaceMarkDot`: the accent's bead for a word owed, the green tick for work
 * finished unseen) and said after its name on the plate. Under the plate, away from the station, the applications' acts, glyphs too.
 *
 * Pressed, a place is gone to. Held (the press that brought it up still down), letting go over a place goes there, and anywhere else
 * leaves the wheel up. Keys: 1 to 5 the inner ring's places, the arrows round the places, Enter on one, Escape (or the backtick again)
 * puts it away, as does a press on the ground. On a phone it is a fan from the foot with the same places at the same sides.
 *
 * The places are a menu of items (a reader of the screen hears each one's name, its mark's words as its description, and the place on
 * screen as the current page); arrows
 * move round it. Drawn by this module's `PlacesProvider` while it is up, into the body, over every page; it states it owns Escape
 * (`OWNS_ESCAPE`).
 */
export function PlacesWheel({ places, acts, from, held, leaving, onClose }: PlacesWheelProps) {
  const { t } = useTranslation();
  const width = useSyncExternalStore(subscribeToResize, readWidth);
  const height = useSyncExternalStore(subscribeToResize, readHeight);
  const dial = dialFor(width, height, acts.length > 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const markIds = useId();
  const [over, setOver] = useState<PlaceId | null>(null);
  const [holding, setHolding] = useState(held !== null);
  // Whether a place has been chosen: a release and the click after it are one choice, never two goes.
  const chosenRef = useRef(false);

  const choose = useCallback((place: Place) => {
    if (chosenRef.current) return;
    chosenRef.current = true;
    // Where the reader already is: put away, nothing gone to.
    if (place.here) {
      onClose(true);
      return;
    }
    onClose(false);
    place.go();
  }, [onClose]);

  // The focus comes into it, so its keys are heard here and a reader of the screen is told what opened.
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true });
  }, []);

  // HELD: the pointer that brought it up points at a place by passing over it, and goes there by letting go on it.
  useEffect(() => {
    if (!holding || held === null) return undefined;
    const onMove = (event: PointerEvent) => {
      if (event.pointerId === held) setOver(placeAt(event.clientX, event.clientY));
    };
    const onUp = (event: PointerEvent) => {
      if (event.pointerId !== held) return;
      setHolding(false);
      const id = placeAt(event.clientX, event.clientY);
      const place = places.find((each) => each.id === id);
      if (place !== undefined) choose(place);
    };
    const onCancel = (event: PointerEvent) => {
      if (event.pointerId === held) setHolding(false);
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    return () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
    };
  }, [holding, held, places, choose]);

  // ITS KEYS, on the window's capture ahead of the page's own: Escape, the inner ring's numbers, the arrows round, Tab kept inside.
  useEffect(() => {
    if (leaving) return undefined;
    const order = [...places].sort((a, b) => (a.ring === b.ring ? SLOT[a.id] - SLOT[b.id] : a.ring === 'inner' ? -1 : 1));
    const focusPlace = (id: PlaceId) => rootRef.current?.querySelector<HTMLElement>(`[data-place-name="${id}"]`)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape' || event.code === 'Backquote' || event.key === '`') {
        event.preventDefault();
        onClose(true);
        return;
      }
      if (/^[1-5]$/.test(event.key)) {
        const place = order.find((each) => each.ring === 'inner' && SLOT[each.id] === Number(event.key) - 1);
        if (place === undefined) return;
        event.preventDefault();
        choose(place);
        return;
      }
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      if (step !== undefined && order.length > 0) {
        event.preventDefault();
        const at = order.findIndex((each) => each.id === (document.activeElement as HTMLElement | null)?.dataset.placeName);
        const next = at < 0 ? (step > 0 ? 0 : order.length - 1) : (at + step + order.length) % order.length;
        focusPlace(order[next].id);
        return;
      }
      if (event.key === 'Tab') {
        const presses = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? []);
        if (presses.length === 0) return;
        const at = presses.indexOf(document.activeElement as HTMLElement);
        const next = at < 0 ? (event.shiftKey ? presses.length - 1 : 0) : (at + (event.shiftKey ? -1 : 1) + presses.length) % presses.length;
        event.preventDefault();
        presses[next].focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [leaving, places, choose, onClose]);

  const { fan, cx, cy, s } = dial;
  const ringOf = (place: Place) => (place.ring === 'inner' ? dial.inner : dial.outer);
  const bearingOf = (place: Place) => ringOf(place).mids[SLOT[place.id]];
  const pointed = places.find((place) => place.id === over) ?? null;

  // The hairline from the press it came out of to the rim, at a desk: the wheel is that press's.
  let leader: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (!fan && from !== null) {
    const dx = from.x - cx;
    const dy = from.y - cy;
    const distance = Math.hypot(dx, dy);
    if (distance > 300 * s + 30) leader = { x1: from.x - (dx / distance) * 24, y1: from.y - (dy / distance) * 24, x2: cx + (dx / distance) * 300 * s, y2: cy + (dy / distance) * 300 * s };
  }

  const pointAt = (event: ReactPointerEvent) => {
    // A mouse or a pen passing over a place points at it; leaving every place points at none.
    if (event.pointerType === 'touch' && !holding) return;
    const id = (event.target as Element).closest?.('[data-place]')?.getAttribute('data-place') as PlaceId | undefined;
    setOver(id ?? null);
  };

  return createPortal(
    <div
      ref={rootRef}
      data-places-wheel=""
      data-fan={fan ? 'true' : 'false'}
      data-leaving={leaving ? 'true' : 'false'}
      tabIndex={-1}
      // Settling away it is out of reach: nothing in it keeps the focus or takes a press while the page under it is already in use.
      {...(leaving ? OUT_OF_REACH : OWNS_ESCAPE)}
      className="places-wheel"
      onPointerMove={pointAt}
    >
      {/* A press on the ground puts it away, as the press goes down: the click a finger's tap sends after it lifts lands on the
          ground too, and the tap that summoned the wheel must not be the one that puts it away. */}
      <div className="places-wheel-ground" onPointerDown={() => onClose(true)} />
      <svg className="places-wheel-rings" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
        {!fan && <circle className="places-wheel-hair" cx={cx} cy={cy} r={300 * s} />}
        {!fan && <circle className="places-wheel-hair" cx={cx} cy={cy} r={92 * s} />}
        {leader !== null && (
          <g className="places-wheel-leader">
            <circle cx={from?.x} cy={from?.y} r={24} />
            <line x1={leader.x1} y1={leader.y1} x2={leader.x2} y2={leader.y2} />
          </g>
        )}
        {places.map((place, index) => {
          const ring = ringOf(place);
          const mid = bearingOf(place);
          return (
            <path
              key={place.id}
              data-place={place.id}
              data-ring={place.ring}
              data-here={place.here ? 'true' : 'false'}
              data-over={over === place.id ? 'true' : 'false'}
              d={sectorPath(cx, cy, ring.r0, ring.r1, mid - ring.half + GAP, mid + ring.half - GAP)}
              style={{ '--i': index, transformOrigin: `${cx}px ${cy}px` } as CSSProperties}
              onClick={() => choose(place)}
            />
          );
        })}
      </svg>

      {/* The places as a menu, each item its glyph over its sector, named for a reader of the screen by its words alone (the
          place on screen is the page that is current). The last chat keeps its words on screen: its title, and at a desk what it is. */}
      <div role={leaving ? undefined : 'menu'} aria-label={t('places.wheel')} className="places-wheel-menu">
        {places.map((place, index) => {
          const ring = ringOf(place);
          const mid = bearingOf(place);
          const [x, y] = polar(cx, cy, ring.at, mid);
          const Icon = place.icon;
          const inner = place.ring === 'inner';
          return (
            <button
              key={place.id}
              type="button"
              role="menuitem"
              data-place={place.id}
              data-place-name={place.id}
              data-ring={place.ring}
              data-over={over === place.id ? 'true' : 'false'}
              data-here={place.here ? 'true' : 'false'}
              aria-current={place.here ? 'page' : undefined}
              aria-describedby={place.mark === null ? undefined : `${markIds}-${place.id}`}
              aria-keyshortcuts={inner && !fan ? String(SLOT[place.id] + 1) : undefined}
              className="places-wheel-name"
              style={{ left: x, top: y, '--i': index } as CSSProperties}
              onFocus={() => setOver(place.id)}
              onClick={() => choose(place)}
            >
              <span className="places-wheel-glyph-box">
                <Icon className="places-wheel-glyph" strokeWidth={inner ? 1.4 : 1.5} aria-hidden="true" />
                {place.mark !== null && <PlaceMarkDot kind={place.mark.kind} />}
              </span>
              {place.id === 'chat' ? (
                <>
                  <span className="places-wheel-word">{place.label}</span>
                  {!fan && <span className="places-wheel-sub">{t('places.lastChat')}</span>}
                </>
              ) : (
                <span className="sr-only">{place.label}</span>
              )}
            </button>
          );
        })}
        {/* The marks' words, each the description of its place's item: outside the items, so an item's name stays its own. */}
        {places.map((place) => place.mark !== null && (
          <span key={place.id} id={`${markIds}-${place.id}`} hidden>{place.mark.words}</span>
        ))}
      </div>

      <div className="places-wheel-core" style={{ left: cx - dial.core / 2, top: cy - dial.core / 2, width: dial.core, height: dial.core }}>
        <CompanionFace
          size={dial.core}
          bare
          form={pointed !== null && !pointed.here ? 'reading' : undefined}
          bearing={pointed !== null && !pointed.here ? 90 - bearingOf(pointed) : undefined}
        />
      </div>

      {/* The name of the place pointed at, while it is pointed at, and what waits there: empty, the plate is absent. */}
      {pointed !== null && (
        <p key={pointed.id} className="places-wheel-plate" data-here={pointed.here ? 'true' : 'false'} style={{ top: dial.plateY }}>
          {pointed.label}
          {pointed.mark !== null && <span className="places-wheel-plate-words" data-mark={pointed.mark.kind}>{` · ${pointed.mark.words}`}</span>}
        </p>
      )}

      {acts.length > 0 && (
        <div className="places-wheel-acts" style={{ top: dial.actsY }}>
          {acts.map((act) => {
            const ActIcon = act.icon;
            return (
              <Button
                key={act.key}
                type="button"
                variant="secondary"
                size="icon"
                aria-label={act.label}
                title={act.label}
                onClick={() => {
                  onClose(false);
                  act.run();
                }}
              >
                <ActIcon aria-hidden="true" />
              </Button>
            );
          })}
        </div>
      )}
    </div>,
    document.body,
  );
}
