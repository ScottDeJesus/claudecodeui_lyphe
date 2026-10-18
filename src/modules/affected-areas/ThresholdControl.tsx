import type { TFunction } from 'i18next';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';

import { isThin, lineWords, sameLine } from '@/modules/affected-areas/utils/provingModel';
import type { ProvingClass } from '@/shared/affected-areas-types';
import { AFFECTED_AREAS_LANE_FAULTS } from '@/shared/constants';
import { Banner, Button, Stepper } from '@/shared/ui';

type ThresholdControlProps = {
  /** The open kind, its line in force among its fields. */
  kind: ProvingClass;
  /** Where the stepper stands; null while it stands at the line in force. */
  line: number | null;
  /** Set threshold's press is out. */
  pressing: boolean;
  /** Why the last press set no line: the engine's reason code or the lane's trouble; null when none stands. */
  refusal: string | null;
  /** A step down (-1) or up (1), 0.05 each. */
  onStep: (direction: -1 | 1) => void;
  onSetThreshold: () => void;
};

/** The reasons `PUT /thresholds/{kind}` refuses a line (`judgment/thresholds.py`), each with its own sentence. */
const ENGINE_REFUSALS: readonly string[] = ['not_a_person', 'bad_class', 'bad_threshold'];

/** A refusal in words: the engine's reason, the lane's fault (in the Tours view's words for it), or a press that failed some other way. */
function refusalWords(refusal: string, t: TFunction): string {
  if (ENGINE_REFUSALS.includes(refusal)) return t(`affectedAreas.tables.refused.${refusal}`);
  if (AFFECTED_AREAS_LANE_FAULTS.some((fault) => fault === refusal)) return t(`affectedAreas.trouble.${refusal}`);
  if (refusal === 'failed' || refusal === 'gone') return t('affectedAreas.tables.refused.failed');
  return t('affectedAreas.tables.refused.other', { reason: refusal });
}

/**
 * A KIND'S LINE, MOVED AND SET: the house `Stepper` from 0% to 100% in steps of five points (0.05 on the wire), starting
 * at the line in force, and Set threshold beside it. The line is said in percent, the unit a region's confidence is said
 * in ("72% sure"). The stepper starts at the engine's default and says "not set" while it stands at a line nobody set:
 * the default only starts the control and previews the figures, and no area stands on it. A refusal is said above the
 * press it refuses, and the press waits while it is out, with the stepper held still.
 *
 * Set threshold is offered when it would change something: a moved line, or a default line set where it stands, which
 * makes it the operator's own ("set Oct 17" in place of "No threshold set"). When it would change nothing it refuses the press
 * (`aria-disabled`, the house `Button`'s own refusal) and is never `disabled`: the answer to a press is what makes the
 * set line the line in force, and a real `disabled` would blur the button under the finger that pressed it, sending
 * the keyboard back to the top of the app. It stays offered on a thin kind, with a word on why: the numbers cannot
 * measure that line, and the operator may set it on his own judgment. Under the press, one sentence on what a line
 * does, since moving it moves what stands on every pano.
 *
 * Used by the affected-areas module's `ProvingDetail`, in a kind's opened row. It draws the press and sends nothing:
 * `TablesScreen` holds the line, the press and its answer.
 */
export function ThresholdControl({ kind, line, pressing, refusal, onStep, onSetThreshold }: ThresholdControlProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const value = line ?? kind.threshold;
  const offered = kind.isDefault || !sameLine(value, kind.threshold);

  return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-2.5">
      <h3 id={headingId} className="text-xs uppercase tracking-[0.14em] text-ink-faint">{t('affectedAreas.tables.control.title')}</h3>
      {refusal !== null && (
        <div role="alert">
          <Banner tone="warn">
            <p className="text-sm font-medium">{refusalWords(refusal, t)}</p>
          </Banner>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Stepper
          value={lineWords(value, t)}
          note={line === null && kind.isDefault ? t('affectedAreas.tables.control.default') : undefined}
          onDecrease={() => onStep(-1)}
          onIncrease={() => onStep(1)}
          canDecrease={!pressing && !sameLine(value, 0)}
          canIncrease={!pressing && !sameLine(value, 1)}
          decreaseLabel={t('affectedAreas.tables.control.lower')}
          increaseLabel={t('affectedAreas.tables.control.raise')}
          ariaLabel={t('affectedAreas.tables.control.label', { kind: kind.label })}
        />
        <Button size="sm" className="max-md:h-11" busy={pressing} aria-disabled={!offered || undefined} onClick={onSetThreshold}>
          {pressing ? t('affectedAreas.tables.control.setting') : t('affectedAreas.tables.setThreshold')}
        </Button>
      </div>
      {isThin(kind) && <p className="text-[12.5px] text-foreground">{t('affectedAreas.tables.control.thin')}</p>}
      <p className="text-xs text-muted-foreground">{t('affectedAreas.tables.control.standing')}</p>
    </section>
  );
}
