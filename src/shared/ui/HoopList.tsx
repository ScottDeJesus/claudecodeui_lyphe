import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, ReactNode } from 'react';

import { SUBAGENT_DOT_FILL } from '@/shared/constants';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { HoopHandle, HoopSlot } from '@/shared/types';
import { Rule } from '@/shared/ui/Rule';
import { cn, resizeObserverIn } from '@/shared/utils';

type HoopListProps = {
  /**
   * The things, a run's together, in the order the hoop would stand them. A list holds every thing, so it is given them all, not a
   * hoop's share; a run's "more" slot, if one is given, is a row that opens the rest.
   */
  slots: HoopSlot[];
  /** What the list holds, for assistive tech: "The board", "The fleet". */
  label: string;
  /** The thing open now, by id: its row is marked as the one open, and brought into view whenever it changes. */
  current?: string | null;
  /** A row was pressed: open its thing. */
  onOpen: (id: string) => void;
  /** What heads the list: the instrument's core, with its own presses and its measure. */
  core?: ReactNode;
  /** The core's measure in words, beside it ("Fixed · 4 of 17"); null for none. */
  reading?: string | null;
  /** How many things a run holds, by run, where that is more than its rows (a lane read a page at a time); absent, its rows. */
  counts?: Record<string, number>;
  /** What stands under a run's rows: the press that reads its next page, while there is one. */
  after?: (group: string) => ReactNode;
  /**
   * The width, in px, of what opens from a row at a desk. The list stands in the middle where that leaves the Opening room on its
   * right, moves left and narrows only as far as it must, and gives the room up where it would be left narrower than a phone; under
   * the width an Opening stands beside anything in, the Opening is a sheet at the foot and the list keeps its middle.
   */
  room?: number;
  /** Marks for the list's root, for the styles and the check scripts that reach it. */
  marks?: Record<`data-${string}`, string | number | undefined>;
};

/** A run of the list: its things, under its name. */
type ListRun = { id: string; name: string | null; slots: HoopSlot[] };

/** The list's column: 600 px at most, and never narrower than 360 px to make room for an Opening; 16 px clear of each side. */
const COLUMN_MOST = 600;
const COLUMN_LEAST = 360;
const GUTTER = 16;
/** What an Opening keeps between itself and its row (the Opening's own gap) and between itself and the room's edge. */
const OPENING_CLEARANCE = 52;
/** Under this much room an Opening is a sheet at the foot (the kit's `Opening`), so nothing stands beside the list. */
const SHEET_UNDER = 560;
/** The most beads a tile draws, as the hoop does. */
const MOST_BEADS = 3;

/**
 * The column's width and its place in a list `width` px wide: in the middle, or left of it, and narrower, just far enough to leave an
 * Opening of `room` px its place on the right. Before the list is measured, the middle of whatever it is given.
 */
function columnStyle(width: number, room: number | undefined): CSSProperties {
  if (width === 0) return { width: `min(${COLUMN_MOST}px, 100% - ${2 * GUTTER}px)`, marginLeft: 'auto', marginRight: 'auto' };
  const full = Math.max(0, Math.min(COLUMN_MOST, width - 2 * GUTTER));
  const middle = { width: full, marginLeft: (width - full) / 2 };
  if (room === undefined || width < SHEET_UNDER) return middle;
  // Where the column's right edge may stand at most, for an Opening to fit on its right.
  const edge = width - room - OPENING_CLEARANCE;
  if (edge - GUTTER < COLUMN_LEAST) return middle;
  const narrowed = Math.min(full, edge - GUTTER);
  return { width: narrowed, marginLeft: Math.max(GUTTER, Math.min((width - narrowed) / 2, edge - narrowed)) };
}

/** A thing's row inside the list, by the thing's id; null for a thing the list does not hold. */
function rowIn(root: HTMLElement | null, id: string): HTMLElement | null {
  return root?.querySelector<HTMLElement>(`[data-hoop-row="${CSS.escape(id)}"]`) ?? null;
}

/** The slots as runs, in their order: a run's things stand together, so a new run starts wherever the run changes. */
function runsOf(slots: HoopSlot[]): ListRun[] {
  const runs: ListRun[] = [];
  for (const slot of slots) {
    const id = slot.group ?? '-';
    const last = runs.at(-1);
    if (last !== undefined && last.id === id) last.slots.push(slot);
    else runs.push({ id, name: slot.groupName, slots: [slot] });
  }
  return runs;
}

/**
 * THE HOOP AS A LIST: the same things a hoop stands round its core (`HoopSlot`), as plain rows under the core, a run at a time, for a
 * set too crowded to read round a band. Each row is the thing's tile, then its name over how it stands in words, so nothing has to be
 * turned to the front to be read. The tile says what the slot says, in the same places: its square what the thing is doing (the frame
 * alone asleep, lit, accent dashes turning while at work, the accent breathing while a word is owed, green done, red failed), its lit
 * top edge how far it has got, the beads under it who is helping, and its square's height how much it matters.
 *
 * A press on a row opens its thing (`onOpen`); the arrows, Home and End move between the rows. Each run is headed by its name and how
 * many it holds (the kit's `Rule`), and a run with nothing in it is absent. Its ref answers as the hoop's does (`HoopHandle`): where a
 * thing's row ends on the page, for an Opening to hang from on its right; it has no directions to give.
 *
 * Used by the kanban module's `BugInstrument` (the board's cards and its proposed features) and the cerberus module's
 * `CerberusInstrument` (the fleet's machines), each in place of its hoop when the screen's head switch asks for the list.
 */
export const HoopList = forwardRef<HoopHandle, HoopListProps>(function HoopList(
  { slots, label, current = null, onOpen, core, reading = null, counts, after, room, marks },
  ref,
) {
  const rootRef = useRef<HTMLElement>(null);
  const headingPrefix = useId();
  const hostWindow = useHostWindow();
  // The list's own width, measured: where its column stands, and how wide it is, follow the room it has.
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    // Built from the window the list is drawn in, so a list moved to another window is still measured there.
    const observer = resizeObserverIn(hostWindow, ([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer?.observe(root);
    return () => observer?.disconnect();
  }, [hostWindow]);

  useImperativeHandle(ref, () => ({
    pointOf: (id) => {
      const box = rowIn(rootRef.current, id)?.getBoundingClientRect();
      return box === undefined ? null : { x: box.right, y: box.top + box.height / 2 };
    },
    azimuthOf: () => null,
  }), []);

  // The open thing's row is brought into view, so what opens from it hangs from a row that can be seen.
  useEffect(() => {
    if (current !== null) rowIn(rootRef.current, current)?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    const rows = [...(rootRef.current?.querySelectorAll<HTMLElement>('[data-hoop-row]') ?? [])];
    const at = rows.indexOf(event.target as HTMLElement);
    if (at === -1) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : at + (event.key === 'ArrowDown' ? 1 : -1);
    if (next < 0 || next >= rows.length) return;
    event.preventDefault();
    rows[next].focus();
  };

  return (
    <section
      ref={rootRef}
      {...marks}
      data-hoop-list={slots.length}
      aria-label={label}
      className="scrollbar-thin size-full min-h-0 min-w-0 overflow-y-auto"
      onKeyDown={onKeyDown}
    >
      <div data-hoop-list-column="" className="flex flex-col pb-8" style={columnStyle(width, room)}>
        {core !== undefined && (
          // The core keeps an open thing open as it is pressed, as the hoop round it does: its own press says what opens next.
          <div data-hoop-list-core="" data-ast-keeps-opening="" className="flex items-center gap-3 pt-2">
            {core}
            {reading !== null && (
              <p className="min-w-0 truncate font-mono text-[10px] font-medium uppercase leading-[14px] tracking-[0.14em] text-muted-foreground">{reading}</p>
            )}
          </div>
        )}
        {runsOf(slots).map((run) => {
          const headingId = `${headingPrefix}-${run.id}`;
          return (
            <section key={run.id} data-hoop-list-run={run.id} aria-labelledby={run.name === null ? undefined : headingId} className="pt-4">
              {run.name !== null && <Rule id={headingId} end={counts?.[run.id] ?? run.slots.length}>{run.name}</Rule>}
              <ul className="flex flex-col [&>li+li]:border-t [&>li+li]:border-[color:var(--hairline)]">
                {run.slots.map((slot) => (
                  <li key={slot.id}>
                    <ListRow slot={slot} open={slot.id === current} onOpen={onOpen} />
                  </li>
                ))}
              </ul>
              {after?.(run.id)}
            </section>
          );
        })}
      </div>
    </section>
  );
});

/** One thing's row: its tile, its name over how it stands, the whole row its press. */
function ListRow({ slot, open, onOpen }: { slot: HoopSlot; open: boolean; onOpen: (id: string) => void }) {
  const titleTone = slot.state === 'waiting' ? 'text-accent-ink' : slot.state === 'asleep' ? 'text-muted-foreground' : 'text-foreground';
  return (
    <button
      type="button"
      data-hoop-row={slot.id}
      data-hoop-row-state={slot.state}
      // A press on another row while one thing is open turns the Opening to it, as a press on another slot of the hoop does.
      data-ast-keeps-opening=""
      aria-current={open ? 'true' : undefined}
      className="group/row relative flex min-h-[52px] w-full items-center gap-3 py-1.5 pr-1 text-left outline-none focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring"
      onClick={() => onOpen(slot.id)}
    >
      {open && <span aria-hidden="true" className="absolute inset-y-2 -left-3 w-0.5 rounded-full" style={{ background: 'var(--accent)' }} />}
      <SlotTile slot={slot} />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('line-clamp-2 break-words text-sm leading-[18px]', titleTone, open && 'font-medium')}>{slot.title}</span>
        {slot.words !== '' && (
          <span
            data-hoop-row-working={slot.state === 'working' ? '' : undefined}
            className={cn(
              'flex min-w-0 items-center gap-1.5 font-mono text-[10px] uppercase leading-[14px] tracking-[0.04em]',
              slot.state !== 'working' && 'text-muted-foreground',
            )}
            style={slot.state === 'working' ? { color: 'var(--accent)' } : undefined}
          >
            {slot.state === 'working' && (
              <span aria-hidden="true" className="size-1.5 flex-none rounded-full motion-safe:animate-[vv-pulse_2.4s_ease-in-out_infinite]" style={{ background: 'var(--accent)' }} />
            )}
            <span className="truncate">{slot.words}</span>
          </span>
        )}
      </span>
    </button>
  );
}

/**
 * A thing's slot, small, as the hoop draws it on its band: the square in its frame, standing as tall as the thing matters; its top edge
 * lit as far as it has got; a bead under the square for each helper at work, in its model's colour. Drawn `aria-hidden`: the row's
 * words say how it stands.
 */
function SlotTile({ slot }: { slot: HoopSlot }) {
  // The square stands on the tile's floor: the full 15 px for a thing that matters most, down to 6 px.
  const tall = Math.round(15 * Math.min(1, Math.max(0.4, slot.height ?? 1)));
  const top = 23 - tall;
  const edge = Math.min(1, Math.max(0, slot.edge));
  const beads = slot.beads.slice(0, MOST_BEADS);
  const lit = { fill: 'color-mix(in srgb, var(--ink) 20%, transparent)', stroke: 'var(--ink-muted)' };
  return (
    <svg aria-hidden="true" viewBox="0 0 40 28" width={40} height={28} data-hoop-tile={slot.state} className="block flex-none">
      <rect x={0.5} y={0.5} width={39} height={27} fill="none" className="stroke-border transition-colors group-hover/row:stroke-foreground group-focus-visible/row:stroke-foreground" />
      {edge > 0 && (
        <>
          {edge < 1 && <rect x={4} y={3} width={32} height={2} style={{ fill: 'color-mix(in srgb, var(--ink-muted) 35%, transparent)' }} />}
          <rect data-hoop-tile-edge={edge.toFixed(2)} x={4} y={3} width={32 * edge} height={2} style={{ fill: 'var(--ink-strong)' }} />
        </>
      )}
      {(slot.state === 'idle' || slot.state === 'working') && <rect x={4.5} y={top} width={31} height={tall} strokeWidth={0.75} style={lit} />}
      {slot.state === 'working' && (
        <circle
          cx={20}
          cy={top + tall / 2}
          r={Math.max(2.5, Math.min(5.5, tall / 2 - 1))}
          fill="none"
          strokeWidth={1}
          strokeDasharray="2.4 1.8"
          style={{ stroke: 'var(--accent)', transformBox: 'fill-box', transformOrigin: 'center' }}
          className="motion-safe:animate-[spin_9s_linear_infinite]"
        />
      )}
      {slot.state === 'waiting' && (
        <rect x={4} y={top} width={32} height={tall} rx={0.5} style={{ fill: 'var(--accent)' }} className="motion-safe:animate-[vv-pulse_2.4s_ease-in-out_infinite]" />
      )}
      {slot.state === 'done' && <rect x={4} y={top} width={32} height={tall} rx={0.5} style={{ fill: 'var(--pos-dot)', opacity: 0.8 }} />}
      {slot.state === 'failed' && <rect x={4} y={top} width={32} height={tall} rx={0.5} style={{ fill: 'var(--danger-dot)' }} />}
      {slot.state === 'more' && (
        <g style={{ fill: 'var(--ink-muted)' }}>
          {[14, 20, 26].map((x) => <circle key={x} cx={x} cy={15} r={1.6} />)}
        </g>
      )}
      {beads.map((bead, index) => (
        <circle
          // The beads are a row of like things with no identity of their own: the place in the row is the key.
          key={index}
          cx={20 + (index - (beads.length - 1) / 2) * 5}
          cy={25.4}
          r={1.5}
          style={{ fill: bead ? SUBAGENT_DOT_FILL[bead] : 'var(--ink-muted)' }}
        />
      ))}
    </svg>
  );
}
