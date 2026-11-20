import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AccountWeekRing, useAccountWeek } from '@/modules/accounts';
import { CompanionFace } from '@/modules/companion/CompanionFace';
import { useCompanion } from '@/modules/companion/context/CompanionContext';
import { CORE_BODY_SHARE } from '@/shared/constants';
import type { AstrolabeGauge } from '@/shared/types';
import { cn, coreContextTone, coreGaugeRadius } from '@/shared/utils';

/** A press laid over the core, centred on it: the body's, then each ring's band round it. */
const PRESS = 'absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-1 focus-visible:ring-ring';

type CompanionCoreProps = {
  /** The side of the square the core is drawn in, in px. Its body is `CORE_BODY_SHARE` of it, and its rings stand on the body. */
  size: number;
  /** What a press on the body does, in words: its name for a screen reader and its title for a pointer. */
  label: string;
  /** The body, pressed. */
  onPress: () => void;
  /**
   * Whether each ring keeps a press of its own: at a desk, round a core large enough for bands a pointer can tell apart. Otherwise the
   * whole square is the body's press and only the account's band, outside it, is the account's (a phone: a ring's band is no target
   * for a finger).
   */
  layered: boolean;
  /**
   * The inner ring, pressed, with what it opens in words: her conversation, whose fullness the ring is. Absent, the ring is a reading
   * only and the body's press takes its band.
   */
  context?: { label: string; onPress: () => void };
  /** What stands round the core, handed the radius of its outer ring in px: the draft she holds for your Send (the station's). */
  around?: (outerRadius: number) => ReactNode;
  /** Marks on the body's press, for the page's scripts and styles. */
  pressMarks?: Record<`data-${string}`, string>;
};

/**
 * KAYLEE'S CORE AS A CHAT'S CORE IS DRAWN: the body alone, with two rings in orbit close on it and nothing else round it. The body takes
 * a form for what she is doing (a tide at rest, the dish while she listens, lobes while she speaks, the polyhedron while she thinks, a
 * mouth while she reads, a tendril while she drafts), so no loop of its own says it. The INNER RING is how full her conversation is
 * (`picture.context`: her CLI's count of the tokens it holds against where she writes her note and starts fresh); the OUTER is the
 * account's week (`useAccountWeek`). Each is grey, then yellow, then red as it runs high (the context by `coreContextTone`, the week by
 * the account's own bands), whatever her material. At rest the two lie flat and still; they tip into orbit while she works, speaks or
 * listens (the instrument's own rule).
 *
 * THE PRESSES, ONE INSIDE THE OTHER where the core is `layered`: the body (`onPress`), the inner ring's band (`context`, her
 * conversation), and the outer ring's band (`AccountWeekRing`, the account switcher). Each band runs from halfway to its inner neighbour
 * to halfway to its outer one, so a press on a ring lands on that ring. Not layered, the whole square is the body's.
 *
 * Used, through the barrel, by the station module's `StationKaylee` (the core in the halo) and the project-workspace module's
 * `WorkspaceHome` (the core docked at the home's foot). `data-companion-core-context` carries the context's reading in percent for a
 * script; it is empty while the conversation has not been counted.
 */
export function CompanionCore({ size, label, onPress, layered, context: contextPress, around, pressMarks }: CompanionCoreProps) {
  const { t } = useTranslation();
  const { picture } = useCompanion();
  const week = useAccountWeek();
  // A server from before the count sends none: not counted.
  const counted = picture?.context ?? null;
  const filled = counted === null ? 0 : Math.min(1, Math.max(0, counted.used / counted.closesAt));
  const gauges = useMemo<AstrolabeGauge[]>(() => [
    { value: counted === null ? null : filled, tone: coreContextTone(filled) },
    { value: week.percent === null ? null : Math.min(100, Math.max(0, week.percent)) / 100, tone: week.tone },
  ], [counted, filled, week.percent, week.tone]);

  // The rings stand on the body, not on the square's edge: measured from the body, as the instrument draws them.
  const bodyRadius = size * CORE_BODY_SHARE;
  const contextRadius = coreGaugeRadius(bodyRadius, 0);
  const accountRadius = Math.round(coreGaugeRadius(bodyRadius, 1));
  const contextBand = 2 * Math.round((contextRadius + accountRadius) / 2);
  const bodyPress = !layered ? size : contextPress !== undefined ? 2 * Math.round((bodyRadius + contextRadius) / 2) : contextBand;
  const percent = Math.round(filled * 100);
  const contextWords = counted === null
    ? t('companion.core.contextUncounted', { defaultValue: 'Context · not counted yet' })
    : t('companion.core.context', { defaultValue: 'Context · {{percent}}% used', percent });

  return (
    <span data-companion-core="" data-companion-core-context={counted === null ? '' : percent} className="relative grid shrink-0 place-items-center" style={{ width: size, height: size }}>
      {/* The account's week: its name and its press, a clear band where the outer ring orbits. The ring itself is the core's drawing. */}
      <AccountWeekRing radius={accountRadius} drawn={false} />
      {layered && contextPress !== undefined && (
        <button
          type="button"
          data-companion-core-context-press=""
          aria-label={`${contextWords}. ${contextPress.label}`}
          title={contextWords}
          onClick={contextPress.onPress}
          className={PRESS}
          style={{ width: contextBand, height: contextBand }}
        />
      )}
      <button
        type="button"
        {...pressMarks}
        aria-label={label}
        // Where the inner ring has no press of its own, the body's title names it too: a pointer resting on it learns the reading.
        title={layered && contextPress !== undefined ? label : `${label} · ${contextWords}`}
        onClick={onPress}
        className={cn(PRESS, 'transition-transform duration-150 hover:scale-[1.04] focus-visible:ring-offset-4 focus-visible:ring-offset-background')}
        style={{ width: bodyPress, height: bodyPress }}
      >
        {/* The drawing keeps its own square, pinned by its middle to the press's, whatever the press's size: where the press is the body
            alone it is smaller than the square, and the rings the drawing wears run past it. */}
        <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2 grid -translate-x-1/2 -translate-y-1/2 place-items-center" style={{ width: size, height: size }}>
          <CompanionFace size={size} bare gauges={gauges} />
        </span>
      </button>
      {around?.(accountRadius)}
    </span>
  );
}
