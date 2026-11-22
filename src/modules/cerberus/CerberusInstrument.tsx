import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';
import { useHostWindow } from '@/shared/context/HostWindowContext';
import type { FleetDoing, HoopHandle, HoopSlot, HoopView, InstrumentMeasure } from '@/shared/types';
import { Hoop, HoopList, hoopWidthFor, InstrumentCore } from '@/shared/ui';
import { cn, resizeObserverIn } from '@/shared/utils';

/** How often the core's bearing follows the machine being fixed, in ms: the hoop turns, and the tendril follows the machine. */
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
/** The most of the hoop one machine takes, in radians: a fleet of a few machines stands them side by side, not each a wall half round it. */
const SLOT_MOST = (Math.PI * 2) / 12;
/** The core's body at the head of the list, in px: at a desk, and in a room narrower than an Opening can stand beside (a phone). */
const LIST_CORE = 64;
const LIST_CORE_NARROW = 48;
/** The narrowest room an Opening stands beside its row in; under it, it is a sheet at the foot (the kit's `Opening`). */
const LIST_WIDE_FROM = 560;
/** What opens from a row at a desk, a machine's Opening, in px: the list leaves it its room on the right. */
const OPENING_WIDTH = 460;

type CerberusInstrumentProps = {
  /** The hoop's handle, for an Opening to hang from a machine's slot and for the core to find the machine being fixed. */
  hoopRef: RefObject<HoopHandle>;
  /** The fleet's machines as slots (`utils/fleetHoop`). */
  slots: HoopSlot[];
  doing: FleetDoing;
  /** The measure the core wears: the share of checks passing. Absent while the fleet has no check. */
  measure: InstrumentMeasure | null;
  /** Docked at the foot beside another face: a small picture with no presses of its own, and no measure. */
  docked?: boolean;
  /** Something hangs open from the instrument: a press on another slot opens that one, as it comes round. */
  held: boolean;
  /** The thing the hoop stands turned to: the open machine, or the "more" slot of the run it is past; null for none. */
  current: string | null;
  /** A slot facing you was pressed: a machine, or a run's further machines. */
  onOpen?: (slotId: string) => void;
  /** The core was pressed: the fleet itself. */
  onCore?: () => void;
  /** The measure was pressed: the fleet's history. */
  onMeasure?: () => void;
  /** How the fleet is shown at home: the hoop, or the same machines as a list under the core (`HoopList`). Docked, it is the hoop. */
  view?: HoopView;
};

/**
 * CERBERUS'S INSTRUMENT: the fleet's machines as slots on the kit's hoop (`Hoop`) round Cerberus's core, a run for each state a machine
 * can be in, what needs you first (`utils/fleetHoop`). Its core is the fleet watching itself, and its form says what the fleet is doing
 * without a word: at rest a tide; the listening dish while a check needs a person (as a chat's core is while it waits on you); thinking
 * while a warden updates; and while a fix runs it takes the writing form, its tendril toward that machine's slot and a line out to it.
 * Round the core, one measure: the share of the fleet's checks passing, and a press on it opens the fleet's history (`InstrumentCore`).
 *
 * It fills the room it is given and stands the hoop as wide as that room allows, up to the design system's home size. Its slots open
 * their machines (`onOpen`), its core opens the fleet (`onCore`). Docked at the foot beside another face it keeps running, small, and
 * takes no press of its own: the foot's own press is the way back to it.
 *
 * AS A LIST (`view`, the head's switch): the same machines as rows under the same core, a run at a time, every machine on its row
 * (`HoopList`); the core heads the list with its measure in words beside it, and keeps its presses. The hoop's handle is the list's
 * then, so a machine's Opening hangs from its row as it hangs from its slot.
 *
 * Drawn by the panel (`CerberusPanel`), at home in the scene's middle and docked at its foot.
 */
export function CerberusInstrument({ hoopRef, slots, doing, measure, docked = false, held, current, onOpen, onCore, onMeasure, view = 'hoop' }: CerberusInstrumentProps) {
  const { t } = useTranslation();
  const draw = useCoreDrawing();
  const hostWindow = useHostWindow();
  const roomRef = useRef<HTMLDivElement>(null);
  // The room the instrument is given, measured: the hoop is as wide as it allows.
  const [room, setRoom] = useState({ w: 0, h: 0 });
  // Where the machine being fixed lies from the core, in degrees, re-read while it is fixed: the tendril follows it round the hoop.
  const [bearing, setBearing] = useState(90);
  const fixing = doing.kind === 'fixing' ? doing.nodeId : null;

  useEffect(() => {
    const box = roomRef.current;
    if (!box) return undefined;
    // Built from the window the screen is drawn in, so a screen moved to another window is still measured there.
    const observer = resizeObserverIn(hostWindow, ([entry]) => setRoom({ w: Math.round(entry.contentRect.width), h: Math.round(entry.contentRect.height) }));
    observer?.observe(box);
    return () => observer?.disconnect();
  }, [hostWindow]);

  useEffect(() => {
    if (fixing === null) return undefined;
    const follow = () => {
      const at = hoopRef.current?.azimuthOf(fixing);
      if (typeof at === 'number') setBearing(Math.round(at));
    };
    const timer = window.setInterval(follow, BEARING_EVERY_MS);
    follow();
    return () => window.clearInterval(timer);
  }, [fixing, hoopRef]);

  const form = doing.kind === 'fixing' ? 'writing' : doing.kind === 'needs' ? 'listening' : doing.kind === 'updating' ? 'thinking' : 'idle';
  const width = docked
    ? Math.max(0, Math.min(room.w, hoopWidthFor(room.h, HOOP_LEAN)))
    : Math.max(0, Math.min(room.w - 2 * HOOP_AIR, HOOP_MOST, hoopWidthFor(room.h - 2 * HOOP_AIR - HOOP_READING, HOOP_LEAN)));
  const body = Math.max(12, Math.round(width * CORE_SHARE));
  const asList = view === 'list' && !docked;

  /** Cerberus's core at a body of `size` px: the same core, its presses and its measure, in the hoop's middle or at the list's head. */
  const coreOf = (size: number) => (
    <InstrumentCore
      size={size}
      label={t('cerberus.ring.core', { defaultValue: 'The fleet' })}
      onPress={onCore}
      measure={docked ? null : measure}
      onMeasure={onMeasure}
      decorative={docked}
      marks={{ 'data-cerberus-core': '' }}
    >
      {draw?.({ material: 'mercury', state: form, drive: form === 'idle' ? 0 : 0.35, size, azimuth: bearing })
        ?? <span aria-hidden="true" className="cerberus-core-still block size-1/2 rounded-full" />}
    </InstrumentCore>
  );

  // One room for both forms, so the room measured stays this element whichever is shown.
  return (
    <div ref={roomRef} {...(docked ? {} : { 'data-cerberus-instrument': '' })} className={cn('flex size-full min-h-0 min-w-0', !asList && 'items-center justify-center')}>
      {asList && (
        <HoopList
          ref={hoopRef}
          slots={slots}
          label={t('cerberus.ring.instrument', { defaultValue: 'The fleet' })}
          current={current}
          onOpen={(slotId) => onOpen?.(slotId)}
          core={coreOf(room.w >= LIST_WIDE_FROM ? LIST_CORE : LIST_CORE_NARROW)}
          reading={measure === null ? null : [measure.label, measure.detail].filter(Boolean).join(' · ')}
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
          label={t('cerberus.ring.instrument', { defaultValue: 'The fleet' })}
          link={fixing === null ? null : { id: fixing, way: 'out' }}
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
