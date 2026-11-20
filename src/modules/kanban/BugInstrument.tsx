import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';
import type { AstrolabePoint, AstrolabeRing, AstrolabeRingGauge, AstrolabeRingItem, AstrolabeRingsHandle } from '@/shared/types';
import { Rings } from '@/shared/ui';

/** How often the core's bearing follows the card it is building, in ms: the ring drifts, and the tendril follows it. */
const BEARING_EVERY_MS = 700;

/**
 * The share of the rings' core square the body is drawn in. The design system's core stands inside its loop, its body about a
 * fifth of the outer ring's radius and inside the measure round it; the instrument's body alone fills its square (`bare`), so it is
 * drawn smaller to stand where the design system's does.
 */
const CORE_SHARE = 0.69;

type BugInstrumentProps = {
  /** The rings' handle, for an Opening to hang from a mark and for the core to find the card it builds. */
  ringsRef: RefObject<AstrolabeRingsHandle>;
  /** The set it turns through: the board's lanes (`utils/bugRings`) or its proposals (`utils/proposalRings`). */
  rings: AstrolabeRing[];
  /** What the set is, for assistive tech: "The board", "Proposed features". */
  label?: string;
  /** The card the dispatcher is building now, by id, if one is: the core writes toward its mark. */
  building: string | null;
  /** The measure the core wears: how much of the board is fixed. Absent while the board holds nothing. */
  gauge: AstrolabeRingGauge | null;
  /** Docked at the foot beside other work: no presses of its own, and no measure. */
  docked?: boolean;
  /** Holds the rings still: an Opening hangs from one of their marks. */
  hold: boolean;
  /** A mark facing you was pressed: a card, or a lane's further cards. */
  onOpen?: (item: AstrolabeRingItem, ring: AstrolabeRing, point: AstrolabePoint | null) => void;
  /** The core was pressed: the board itself. */
  onCore?: () => void;
  /** The measure was pressed: the board's numbers. */
  onGauge?: () => void;
};

/**
 * THE BUG BOARD'S INSTRUMENT: the board's lanes as rings round the board's core (the kit's `Rings`), every card a mark that says
 * where it is, what it is doing, how far it has got and how much it matters (`utils/bugRings`). Its second set is the board's
 * proposed features, a ring for each thing a proposal can be (`utils/proposalRings`): the face chosen at the foot is the set. Its core is the board running
 * itself: at rest a tide, and while the dispatcher builds a card it takes the writing form, its tendril at that card's mark, so
 * what the board is doing is the core's shape and never a word beside it. Round the core, one measure: how much of the board is
 * fixed, quiet, and a press on it opens the board's numbers.
 *
 * Its marks open their cards (`onOpen`), its core opens the board (`onCore`). Docked at the foot beside the board's numbers or
 * its proposals it keeps running and takes no press of its own: the foot's own press is the way back to it.
 *
 * Drawn by the panel (`KanbanPanel`), at home in the scene's middle and docked at its foot.
 */
export function BugInstrument({ ringsRef, rings, label, building, gauge, docked = false, hold, onOpen, onCore, onGauge }: BugInstrumentProps) {
  const { t } = useTranslation();
  const draw = useCoreDrawing();
  // Where the card being built lies from the core, in degrees, re-read while it is built: the tendril follows the drifting mark.
  const [bearing, setBearing] = useState(90);
  const innermost = rings[0]?.id ?? null;

  useEffect(() => {
    if (building === null || innermost === null) return undefined;
    const follow = () => {
      const at = ringsRef.current?.azimuthOf(innermost, building);
      if (typeof at === 'number') setBearing(Math.round(at));
    };
    const timer = window.setInterval(follow, BEARING_EVERY_MS);
    follow();
    return () => window.clearInterval(timer);
  }, [building, innermost, ringsRef]);

  return (
    <Rings
      ref={ringsRef}
      rings={rings}
      label={label ?? t('kanban.ring.instrument', { defaultValue: 'The board' })}
      hold={hold}
      decorative={docked}
      gauge={docked || gauge === null ? undefined : [gauge]}
      onGauge={docked || !onGauge ? undefined : () => onGauge()}
      onOpen={docked ? undefined : onOpen}
      onCore={docked ? undefined : onCore}
      coreLabel={t('kanban.ring.board', { defaultValue: 'The board' })}
      core={(size) => {
        // The body's own square, centred in the rings' core square: the instrument fills the box it is given.
        const body = Math.round(size * CORE_SHARE);
        return (
          <span className="grid place-items-center" style={{ width: body, height: body }}>
            {draw?.({ material: 'mercury', state: building === null ? 'idle' : 'writing', drive: building === null ? 0 : 0.35, size: body, azimuth: bearing })
              ?? <span aria-hidden="true" className="block size-1/2 rounded-full bg-[radial-gradient(circle_at_35%_30%,var(--chrome-highlight),var(--chrome-mid)_55%,var(--chrome-dark))]" />}
          </span>
        );
      }}
    />
  );
}
