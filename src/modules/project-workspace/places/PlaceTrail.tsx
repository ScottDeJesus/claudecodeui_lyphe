import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import type { AstrolabeTrackStep, PlaceTrailStep } from '@/shared/types';
import { Opening, Track } from '@/shared/ui';

/** Under this much room the plate is a sheet at the foot (the Opening's rule), and the places a list down it. */
const SHEET_UNDER_PX = 560;

type PlaceTrailProps = {
  /** The places stood on, the newest last. */
  steps: PlaceTrailStep[];
  /** The step that is where the reader stands, or null where it is no place the trail keeps. */
  hereKey: string | null;
  /** The middle of the back arrow that was held, which the plate hangs from. */
  anchor: { x: number; y: number };
  /** Takes the reader back to a step. */
  onGo: (key: string) => void;
  /** Folds it, with nowhere gone to. */
  onClose: () => void;
};

/**
 * THE TRAIL: where the reader has been, as a course read along (the design system's Track), each place named under its step, hung in an
 * Opening from the back arrow that was held. Lit to the place on screen, which is the course's live end; a press on any other step, or
 * its name, goes back there in one press however many places back it is. It folds on its back arrow, Escape, or a press anywhere else.
 *
 * Drawn by this module's `PlacesProvider` while a held back arrow has it open, into the body, over every page.
 */
export function PlaceTrail({ steps, hereKey, anchor, onGo, onClose }: PlaceTrailProps) {
  const { t } = useTranslation();
  // Read once as it opens: a window turned while it is open keeps the arrangement it opened in.
  const [list] = useState(() => window.innerWidth < SHEET_UNDER_PX);
  const count = steps.length;
  const course: AstrolabeTrackStep[] = steps.map((step) => ({ id: step.key, label: step.label, state: step.key === hereKey ? 'live' : 'done' }));
  const go = (key: string) => (key === hereKey ? onClose() : onGo(key));

  return createPortal(
    <div className="places-trail-room" data-place-trail="">
      <Opening
        open
        anchor={anchor}
        onClose={onClose}
        backLabel={t('places.trail.close')}
        source={t('places.trail.source')}
        width={Math.min(640, Math.max(320, 112 * count + 32))}
        marks={{ 'data-place-trail-plate': '' }}
      >
        <Track
          steps={course}
          label={t('places.trail.label')}
          value={hereKey ?? undefined}
          stepLabel={(step, index, n) => t(step.id === hereKey ? 'places.trail.stepHere' : 'places.trail.step', { index: index + 1, count: n, place: step.label })}
          onOpen={(step) => go(step.id)}
        />
        <ol className="places-trail-names" data-list={list ? 'true' : 'false'} style={list ? undefined : { gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
          {steps.map((step) => (
            <li key={step.key}>
              <button type="button" className="places-trail-step" data-trail-step={step.key} data-here={step.key === hereKey ? 'true' : 'false'} onClick={() => go(step.key)}>
                <span className="places-trail-name">{step.label}</span>
                <span className="places-trail-kind">
                  {[t(`places.trail.kind.${step.kind}`), step.key === hereKey ? t('places.here') : null].filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ol>
        <p className="places-trail-hint">{t('places.trail.hint')}</p>
      </Opening>
    </div>,
    document.body,
  );
}
