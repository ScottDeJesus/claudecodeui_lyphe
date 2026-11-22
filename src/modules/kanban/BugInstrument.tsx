import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';
import type { HoopHandle, HoopSlot, HoopView, InstrumentMeasure } from '@/shared/types';
import { Hoop, HoopList, hoopWidthFor, InstrumentCore } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** How often the core's bearing follows the card it is building, in ms: the hoop turns, and the tendril follows the card. */
const BEARING_EVERY_MS = 700;

/** The widest the hoop stands at home, in px (the design system's `size-instrument-home`). */
const HOOP_MOST = 720;
/** The air kept round the hoop at home, in px at each side, and the reading line under it. */
const HOOP_AIR = 16;
const HOOP_READING = 28;
/** How far the hoop leans toward the reader: the station's own lean at a desk, so its far side reads as well as its near. */
const HOOP_LEAN = 0.62;
/** The share of the hoop's width the core's body takes, in its middle: room for its measure inside the band's opening. */
const CORE_SHARE = 0.17;
/** The most of the hoop one card takes, in radians: a board of a few cards stands them side by side, not each a wall half round it. */
const SLOT_MOST = (Math.PI * 2) / 12;
/** The core's body at the head of the list, in px: at a desk, and in a room narrower than an Opening can stand beside (a phone). */
const LIST_CORE = 64;
const LIST_CORE_NARROW = 48;
/** The narrowest room an Opening stands beside its row in; under it, it is a sheet at the foot (the kit's `Opening`). */
const LIST_WIDE_FROM = 560;
/** What opens from a row at a desk, a card's or a proposal's Opening, in px: the list leaves it its room on the right. */
const OPENING_WIDTH = 360;

type BugInstrumentProps = {
  /** The hoop's handle, for an Opening to hang from a card's slot and for the core to find the card it builds. */
  hoopRef: RefObject<HoopHandle>;
  /** The set it turns through: the board's cards (`utils/bugHoop`) or its proposals (`utils/proposalHoop`). */
  slots: HoopSlot[];
  /** What the set is, for assistive tech: "The board", "Proposed features". */
  label?: string;
  /** The card the dispatcher is building now, by id, if one is: the core writes toward its slot. */
  building: string | null;
  /** The measure the core wears: how much of the board is fixed. Absent while the board holds nothing. */
  measure: InstrumentMeasure | null;
  /** Docked at the foot beside other work: a small picture with no presses of its own, and no measure. */
  docked?: boolean;
  /** Something hangs open from the instrument: a press on another slot opens that one, as it comes round. */
  held: boolean;
  /** The thing the hoop stands turned to: the open card, or the "more" slot of the run it is past; null for none. */
  current: string | null;
  /** A slot facing you was pressed: a card, or a run's further cards. */
  onOpen?: (slotId: string) => void;
  /** The core was pressed: the board itself. */
  onCore?: () => void;
  /** The measure was pressed: the board's numbers. */
  onMeasure?: () => void;
  /** How the set is shown at home: the hoop, or the same things as a list under the core (`HoopList`). Docked, it is the hoop. */
  view?: HoopView;
  /** For the list: how many cards each run holds on the server, where its rows are the pages read so far. */
  counts?: Record<string, number>;
  /** For the list: what stands under a run's rows, the press that reads its next page while there is one. */
  after?: (group: string) => ReactNode;
};

/**
 * THE BUG BOARD'S INSTRUMENT: the board's cards as slots on the kit's hoop (`Hoop`) round the board's core, every card a slot that says
 * where it is, what it is doing, how far it has got and how much it matters (`utils/bugHoop`). Its second set is the board's proposed
 * features, a run for each thing a proposal can be (`utils/proposalHoop`): the face chosen at the foot is the set. Its core is the board
 * running itself: at rest a tide, and while the dispatcher builds a card it takes the writing form, its tendril toward that card's slot
 * and a line out to it, so what the board is doing is the core's shape and never a word beside it. Round the core, one measure: how much
 * of the board is fixed, and a press on it opens the board's numbers (`InstrumentCore`).
 *
 * It fills the room it is given and stands the hoop as wide as that room allows, up to the design system's home size. Its slots open
 * their cards (`onOpen`), its core opens the board (`onCore`). Docked at the foot beside the board's numbers it keeps running, small,
 * and takes no press of its own: the foot's own press is the way back to it.
 *
 * AS A LIST (`view`, the head's switch): the same cards as rows under the same core, a lane at a time, every card read so far on its
 * row (`HoopList`); the core heads the list with its measure in words beside it, and keeps its presses. The hoop's handle is the list's
 * then, so an Opening hangs from a card's row as it hangs from its slot.
 *
 * Drawn by the panel (`KanbanPanel`), at home in the scene's middle and docked at its foot.
 */
export function BugInstrument({ hoopRef, slots, label, building, measure, docked = false, held, current, onOpen, onCore, onMeasure, view = 'hoop', counts, after }: BugInstrumentProps) {
  const { t } = useTranslation();
  const draw = useCoreDrawing();
  const roomRef = useRef<HTMLDivElement>(null);
  // The room the instrument is given, measured: the hoop is as wide as it allows.
  const [room, setRoom] = useState({ w: 0, h: 0 });
  // Where the card being built lies from the core, in degrees, re-read while it is built: the tendril follows the card round the hoop.
  const [bearing, setBearing] = useState(90);

  useEffect(() => {
    const box = roomRef.current;
    if (!box || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => setRoom({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    observer.observe(box);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (building === null) return undefined;
    const follow = () => {
      const at = hoopRef.current?.azimuthOf(building);
      if (typeof at === 'number') setBearing(Math.round(at));
    };
    const timer = window.setInterval(follow, BEARING_EVERY_MS);
    follow();
    return () => window.clearInterval(timer);
  }, [building, hoopRef]);

  const width = docked
    ? Math.max(0, Math.min(room.w, hoopWidthFor(room.h, HOOP_LEAN)))
    : Math.max(0, Math.min(room.w - 2 * HOOP_AIR, HOOP_MOST, hoopWidthFor(room.h - 2 * HOOP_AIR - HOOP_READING, HOOP_LEAN)));
  const body = Math.max(12, Math.round(width * CORE_SHARE));
  const setName = label ?? t('kanban.ring.instrument', { defaultValue: 'The board' });

  /** The board's core at a body of `size` px: the same core, its presses and its measure, in the hoop's middle or at the list's head. */
  const coreOf = (size: number) => (
    <InstrumentCore
      size={size}
      label={t('kanban.ring.board', { defaultValue: 'The board' })}
      onPress={onCore}
      measure={docked ? null : measure}
      onMeasure={onMeasure}
      decorative={docked}
      marks={{ 'data-bug-core': '' }}
    >
      {draw?.({ material: 'mercury', state: building === null ? 'idle' : 'writing', drive: building === null ? 0 : 0.35, size, azimuth: bearing })
        ?? <span aria-hidden="true" className="block size-1/2 rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--chrome-highlight),var(--chrome-mid)_55%,var(--chrome-dark))]" />}
    </InstrumentCore>
  );

  const asList = view === 'list' && !docked;

  // One room for both forms, so the room measured stays this element whichever is shown.
  return (
    <div ref={roomRef} {...(docked ? {} : { 'data-bug-instrument': '' })} className={cn('flex size-full min-h-0 min-w-0', !asList && 'items-center justify-center')}>
      {asList && (
        <HoopList
          ref={hoopRef}
          slots={slots}
          label={setName}
          current={current}
          onOpen={(slotId) => onOpen?.(slotId)}
          core={coreOf(room.w >= LIST_WIDE_FROM ? LIST_CORE : LIST_CORE_NARROW)}
          reading={measure === null ? null : [measure.label, measure.detail].filter(Boolean).join(' · ')}
          counts={counts}
          after={after}
          room={OPENING_WIDTH}
        />
      )}
      {!asList && width > 0 && (
        <Hoop
          ref={hoopRef}
          slots={slots}
          width={width}
          lean={HOOP_LEAN}
          names={!docked}
          reading={!docked}
          label={setName}
          link={building === null ? null : { id: building, way: 'out' }}
          coreRadius={body / 2 + 14}
          current={current}
          most={SLOT_MOST}
          openOnTurn={held}
          decorative={docked}
          onOpen={onOpen}
          marks={docked ? undefined : { 'data-ast-keeps-opening': '' }}
        >
          {coreOf(body)}
        </Hoop>
      )}
    </div>
  );
}
