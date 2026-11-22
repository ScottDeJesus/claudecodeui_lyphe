import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { useIsPageHeld } from '@/shared/context/HeldPageContext';
import type { HoopHandle, HoopLink, HoopSlot } from '@/shared/types';
import { createHoopPainter, hoopHeightFor, hoopMiddle } from '@/shared/ui/hoopPainter';
import { cn } from '@/shared/utils';

type HoopProps = {
  /** The things, in their order round the hoop: a run's things (a folder's, a lane's, a state's) side by side. */
  slots: HoopSlot[];
  /** The hoop's width, in px. It is as deep as it leans at that width (`hoopHeightFor`); the reading stands under it. */
  width: number;
  /**
   * How far the hoop is tipped toward the reader, as the share of its width its depth takes; absent, the hoop's own lean. A hoop
   * round a larger core leans less, so its opening has the room for that core.
   */
  lean?: number;
  /** Whether the runs' names are written round it: a hoop standing small writes none. */
  names: boolean;
  /** Whether the thing at the front is read out in words under the hoop. */
  reading: boolean;
  /** What the hoop holds, for assistive tech: its slider's name ("Chats", "The board", "The fleet"). */
  label: string;
  /**
   * The slot what stands in the middle is dealing with now, and the way the words go (`in`: it is read; `out`: it is written to); null
   * for none. A line is drawn from the middle's edge to that slot and a bead travels it. `coreRadius` is the middle's own radius in px,
   * where the line starts.
   */
  link?: HoopLink | null;
  coreRadius?: number;
  /**
   * The thing the hoop stands turned to, by id: the hoop arrives with it at the front, and is brought to it once each time it changes,
   * so a turn the reader gave the hoop stays where they left it. Absent, the hoop opens on the first thing that waits on the reader.
   */
  current?: string | null;
  /** The most of the hoop one slot takes, in radians: absent, a few slots share the whole hoop out between them. */
  most?: number;
  /**
   * While something already hangs open from the hoop: a press on another slot opens that one too as it comes round, where a press on a
   * slot otherwise only turns it to the front and a second press opens it.
   */
  openOnTurn?: boolean;
  /** A picture only: no slider, no press, no reading, and nothing for assistive tech (the caller's own press round it says what it is). */
  decorative?: boolean;
  /** The thing at the front was pressed (or Enter on the hoop), or another while `openOnTurn` says so: it opens. */
  onOpen?: (id: string) => void;
  /** Marks for the hoop's root, for the styles and the check scripts that reach it. */
  marks?: Record<`data-${string}`, string | number | undefined>;
  /** What stands in the hoop's middle: a core. It is drawn over the canvas, so its own presses stay its own. */
  children?: ReactNode;
};

/** The reading's lines: mono, upper case, as the roadmap's stack writes its own. */
const EYEBROW = 'font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.14em] text-muted-foreground';

/**
 * THE DESIGN SYSTEM'S HOOP: a set of things as slots on a band that stands round a core, seen from a little above. It is the standard
 * way the app draws a set you turn through, in place of rings: each thing has a face you can read and press, and the whole set reads at a
 * glance without a list. A slot says how its thing stands in its own places (`hoopPainter`): its square (asleep, awake, at work, waiting
 * on you, finished, failed), its top edge (how far it has got), the beads at its foot (helpers at work) and its height (how much it
 * matters). A run's things stand together with the run's name along the ground.
 *
 * TURNING IT: a drag, the wheel, or the arrows while it has the keyboard (Home and End go to the first and last). The thing at the front,
 * over the pointer, is read out under the hoop: its run, its name, and how it stands in words; under a mouse the thing pointed at is read
 * instead. A press on any other slot brings it to the front; A PRESS ON THE SLOT AT THE FRONT, or Enter, OPENS IT (`onOpen`). On a touch
 * screen that is two taps: the first shows what is chosen, the second goes to it.
 *
 * Its ref answers where a thing's slot stands on the page (`pointOf`, for an Opening to hang from) and its direction from the middle
 * (`azimuthOf`, for a core that reads from it or writes to it). `data-hoop` on its root reads how many things it holds and
 * `data-hoop-front` the one at the front; its slider names its things in order in `data-ring-items` and their runs in `data-ring-groups`.
 *
 * Used by the sidebar module's `SessionsHalo` (the chats round the companion's core and a chat's core), the kanban module's
 * `BugInstrument` (the board's bugs, and its proposed features) and the cerberus module's `CerberusInstrument` (the fleet's machines).
 * The last two can show the same slots as a list instead (`HoopList`), when the screen's head switch asks for it.
 */
export const Hoop = forwardRef<HoopHandle, HoopProps>(function Hoop(
  { slots, width, lean, names, reading, label, link = null, coreRadius = 0, current = null, most, openOnTurn = false, decorative = false, onOpen, marks, children },
  ref,
) {
  const height = hoopHeightFor(width, lean);
  const isPageHeld = useIsPageHeld();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const painterRef = useRef<ReturnType<typeof createHoopPainter> | null>(null);
  // The latest slots and presses, for the listeners set up once below.
  const slotsRef = useRef(slots);
  const pressRef = useRef({ onOpen, openOnTurn });
  useEffect(() => {
    slotsRef.current = slots;
    pressRef.current = { onOpen, openOnTurn };
  }, [slots, onOpen, openOnTurn]);

  // The thing at the front and the thing under the pointer, by place on the hoop. The painter decides both each frame; they are state
  // only so the words and the cursor re-render when one actually changes.
  const [shown, setShown] = useState({ front: -1, hover: -1 });

  useImperativeHandle(ref, () => ({
    pointOf: (id) => {
      const canvas = canvasRef.current;
      const at = painterRef.current?.pointOf(id) ?? null;
      if (!canvas || at === null) return null;
      const box = canvas.getBoundingClientRect();
      return { x: box.left + at[0], y: box.top + at[1] };
    },
    azimuthOf: (id) => painterRef.current?.azimuthOf(id) ?? null,
  }), []);

  // The painter, the theme and the frame loop: set up once, for the life of the canvas.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const painter = createHoopPainter(canvas);
    painterRef.current = painter;
    painter.setSlots(slotsRef.current);

    const theme = () => painter.readTheme(canvas);
    theme();
    // The theme is a class and a few properties on the document's root: re-read the colours whenever it changes.
    const themed = new MutationObserver(theme);
    themed.observe(document.documentElement, { attributes: true });
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    const stillness = () => painter.setStill(calm.matches);
    stillness();
    calm.addEventListener('change', stillness);

    let frame = 0;
    const loop = (now: number) => {
      // A page held under another is not seen, nor is a view folded away behind another: nothing is drawn until it is back.
      if (!isPageHeld() && canvas.offsetParent !== null) {
        const next = painter.frame(now);
        setShown((held) => (held.front === next.front && held.hover === next.hover ? held : next));
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);

    // The wheel is the hoop's while the pointer is on it: a passive listener could not keep the page from scrolling under it.
    const onWheel = (event: WheelEvent) => {
      if (painter.wheel(event.deltaY || event.deltaX, event.timeStamp)) event.preventDefault();
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(frame);
      themed.disconnect();
      calm.removeEventListener('change', stillness);
      canvas.removeEventListener('wheel', onWheel);
      painterRef.current = null;
    };
  }, [isPageHeld]);

  useEffect(() => {
    painterRef.current?.setSlots(slots);
  }, [slots]);
  useEffect(() => {
    painterRef.current?.setMost(most ?? Math.PI * 2);
  }, [most, slots]);
  // The thing the hoop stands turned to, brought to the front once for each such thing: as soon as the hoop holds it, and never again
  // after, so a turn the reader gave the hoop stays where they left it. One the hoop is already turning to (a press brought it round)
  // is left to finish its turn.
  const broughtRef = useRef<string | null>(null);
  useEffect(() => {
    // Nothing to stand turned to: the next thing given is brought round, even the one that was before.
    if (current === null) {
      broughtRef.current = null;
      return;
    }
    if (broughtRef.current === current) return;
    const painter = painterRef.current;
    const index = slots.findIndex((slot) => slot.id === current);
    if (painter === null || index === -1) return;
    if (painter.front() !== index && !painter.bring(current)) return;
    broughtRef.current = current;
  }, [slots, current]);
  useEffect(() => {
    painterRef.current?.resize(width, height, Math.min(2, window.devicePixelRatio || 1), lean);
  }, [width, height, lean]);
  useEffect(() => {
    painterRef.current?.setNames(names);
  }, [names]);
  const linkId = link?.id ?? null;
  const linkWay = link?.way ?? 'in';
  useEffect(() => {
    painterRef.current?.setLink(linkId === null ? null : { id: linkId, way: linkWay }, coreRadius);
  }, [linkId, linkWay, coreRadius]);
  const middle = hoopMiddle(width, height, lean);

  const at = (event: { clientX: number; clientY: number; currentTarget: HTMLCanvasElement }): [number, number] => {
    const box = event.currentTarget.getBoundingClientRect();
    return [event.clientX - box.left, event.clientY - box.top];
  };
  const open = (index: number) => {
    const slot = slotsRef.current[index];
    if (slot !== undefined) pressRef.current.onOpen?.(slot.id);
  };

  // What is read out: the thing under the pointer while there is one (the far half is read by pointing at it), else the one at the front.
  const read = slots[shown.hover] ?? slots[shown.front] ?? null;
  const front = slots[shown.front] ?? null;

  return (
    <div {...marks} data-hoop={slots.length} data-hoop-front={front?.id} className="ast-hoop flex min-w-0 flex-none flex-col items-center" style={{ width }}>
      <div className="relative" style={{ width, height }}>
        <canvas
          ref={canvasRef}
          {...(decorative ? { 'aria-hidden': true } : {
            // A slider over the things: the arrows turn it, and its value is the thing at the front, in words.
            role: 'slider',
            tabIndex: slots.length === 0 ? -1 : 0,
            'aria-label': label,
            'aria-orientation': 'horizontal' as const,
            'aria-valuemin': 1,
            'aria-valuemax': Math.max(1, slots.length),
            'aria-valuenow': shown.front + 1,
            'aria-valuetext': front === null ? undefined : [front.groupName, front.title, front.words].filter(Boolean).join(', '),
            'data-ring-items': slots.map((slot) => slot.id).join(' '),
            'data-ring-groups': slots.map((slot) => slot.group ?? '-').join(' '),
          })}
          className={cn('absolute inset-0 block touch-none outline-none', decorative && 'pointer-events-none', shown.hover !== -1 && 'cursor-pointer')}
          style={{ width, height }}
          onPointerDown={decorative ? undefined : (event) => {
            if (painterRef.current?.pointerDown(...at(event))) event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={decorative ? undefined : (event) => { painterRef.current?.pointerMove(...at(event)); }}
          onPointerUp={decorative ? undefined : (event) => {
            const press = painterRef.current?.pointerUp() ?? null;
            if (press !== null && 'open' in press) open(press.open);
            else if (press !== null && pressRef.current.openOnTurn) open(press.turned);
            // A finger leaves nothing under it once it has lifted.
            if (event.pointerType !== 'mouse') painterRef.current?.pointerLeave();
          }}
          onPointerCancel={decorative ? undefined : () => { painterRef.current?.pointerUp(); painterRef.current?.pointerLeave(); }}
          onPointerLeave={decorative ? undefined : () => painterRef.current?.pointerLeave()}
          onFocus={decorative ? undefined : (event) => painterRef.current?.setFocused(event.currentTarget.matches(':focus-visible'))}
          onBlur={decorative ? undefined : () => painterRef.current?.setFocused(false)}
          onKeyDown={decorative ? undefined : (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              const index = painterRef.current?.front() ?? -1;
              if (slotsRef.current[index] === undefined) return;
              event.preventDefault();
              open(index);
            } else if (painterRef.current?.key(event.key)) {
              event.preventDefault();
            }
          }}
        />
        {/* What stands in the middle, over the canvas. The band passes clear of it, so each keeps its own presses. */}
        {children !== undefined && (
          <div
            data-hoop-middle=""
            className={cn('pointer-events-none absolute grid -translate-x-1/2 -translate-y-1/2 place-items-center', !decorative && '[&>*]:pointer-events-auto')}
            style={{ left: middle.x, top: middle.y }}
          >
            {children}
          </div>
        )}
      </div>
      {reading && !decorative && (
        // Two lines, each on one line: where it is and what it is called, then how it stands. Drawn `aria-hidden`: the slider's value says the same.
        <div data-hoop-reading="" aria-hidden="true" className="flex h-[28px] w-full min-w-0 flex-col items-center text-center">
          {read !== null && (
            <>
              <p className={cn(EYEBROW, 'max-w-full truncate')}>
                {read.groupName !== null && `${read.groupName} › `}
                <span className={read.state === 'waiting' ? 'text-accent-ink' : 'text-foreground'}>{read.title}</span>
              </p>
              <p className={cn(EYEBROW, 'max-w-full truncate')}>{read.words}</p>
            </>
          )}
        </div>
      )}
    </div>
  );
});
