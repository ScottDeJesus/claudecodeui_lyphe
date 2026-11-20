import { useEffect, useState } from 'react';
import type { RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useCoreDrawing } from '@/shared/context/CoreDrawingContext';
import type { AstrolabePoint, AstrolabeRing, AstrolabeRingGauge, AstrolabeRingItem, AstrolabeRingsHandle, FleetDoing } from '@/shared/types';
import { Rings } from '@/shared/ui';

/** How often the core's bearing follows the machine being fixed, in ms: the ring drifts, and the tendril follows it. */
const BEARING_EVERY_MS = 700;

/** The share of the rings' core square the body is drawn in, as the Bugs instrument draws it (the body alone fills its square). */
const CORE_SHARE = 0.69;

type CerberusInstrumentProps = {
  /** The rings' handle, for an Opening to hang from a mark and for the core to find the machine being fixed. */
  ringsRef: RefObject<AstrolabeRingsHandle>;
  /** The fleet's states as rings (`utils/fleetRings`). */
  rings: AstrolabeRing[];
  doing: FleetDoing;
  /** The measure the core wears: the share of checks passing. Absent while the fleet has no check. */
  gauge: AstrolabeRingGauge | null;
  /** Docked at the foot beside another face: no presses of its own, and no measure. */
  docked?: boolean;
  /** Holds the rings still: an Opening hangs from one of their marks. */
  hold: boolean;
  /** A mark facing you was pressed: a machine, or a ring's further machines. */
  onOpen?: (item: AstrolabeRingItem, ring: AstrolabeRing, point: AstrolabePoint | null) => void;
  /** The core was pressed: the fleet itself. */
  onCore?: () => void;
  /** The measure was pressed: the fleet's history. */
  onGauge?: () => void;
};

/**
 * CERBERUS'S INSTRUMENT: the fleet's machines as marks on rings round Cerberus's core (the kit's `Rings`), a ring for each state a
 * machine can be in, what needs you innermost (`utils/fleetRings`). Its core is the fleet watching itself, and its form says what
 * the fleet is doing without a word: at rest a tide; the listening dish while a check needs a person (as a chat's core is while it
 * waits on you); thinking while a warden updates; and while a fix runs it takes the writing form, its tendril at that machine's
 * mark. Round the core, one measure: the share of the fleet's checks passing, quiet; a press on it opens the fleet's history.
 *
 * Its marks open their machines (`onOpen`), its core opens the fleet (`onCore`). Docked at the foot beside another face it keeps
 * running and takes no press of its own: the foot's own press is the way back to it.
 *
 * Drawn by the panel (`CerberusPanel`), at home in the scene's middle and docked at its foot.
 */
export function CerberusInstrument({ ringsRef, rings, doing, gauge, docked = false, hold, onOpen, onCore, onGauge }: CerberusInstrumentProps) {
  const { t } = useTranslation();
  const draw = useCoreDrawing();
  // Where the machine being fixed lies from the core, in degrees, re-read while it is fixed: the tendril follows the drifting mark.
  const [bearing, setBearing] = useState(90);
  const fixing = doing.kind === 'fixing' ? doing.nodeId : null;

  useEffect(() => {
    if (fixing === null) return undefined;
    const follow = () => {
      const at = ringsRef.current?.azimuthOf('needs', fixing);
      if (typeof at === 'number') setBearing(Math.round(at));
    };
    const timer = window.setInterval(follow, BEARING_EVERY_MS);
    follow();
    return () => window.clearInterval(timer);
  }, [fixing, ringsRef]);

  const form = doing.kind === 'fixing' ? 'writing' : doing.kind === 'needs' ? 'listening' : doing.kind === 'updating' ? 'thinking' : 'idle';

  return (
    <Rings
      ref={ringsRef}
      rings={rings}
      label={t('cerberus.ring.instrument', { defaultValue: 'The fleet' })}
      hold={hold}
      decorative={docked}
      gauge={docked || gauge === null ? undefined : [gauge]}
      onGauge={docked || !onGauge ? undefined : () => onGauge()}
      onOpen={docked ? undefined : onOpen}
      onCore={docked ? undefined : onCore}
      coreLabel={t('cerberus.ring.core', { defaultValue: 'The fleet' })}
      core={(size) => {
        // The body's own square, centred in the rings' core square: the instrument fills the box it is given.
        const body = Math.round(size * CORE_SHARE);
        return (
          <span className="grid place-items-center" style={{ width: body, height: body }}>
            {draw?.({ material: 'mercury', state: form, drive: form === 'idle' ? 0 : 0.35, size: body, azimuth: bearing })
              ?? <span aria-hidden="true" className="cerberus-core-still block size-1/2 rounded-full" />}
          </span>
        );
      }}
    />
  );
}
