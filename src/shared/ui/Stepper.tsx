import { Minus, Plus } from 'lucide-react';

/**
 * A value with a minus and a plus either side of it — the form for a setting that moves in
 * fixed steps along a scale, where a slider would be too fine and a select would make the
 * reader translate "Medium" into a size.
 *
 * The buttons carry their own accessible names because a glyph has none, and the value between
 * them is announced through `aria-live` so a reader who cannot see it still hears what the
 * press did. One consumer today: the Appearance tab's chat text size.
 */
type StepperProps = {
  /** Already formatted for reading — "16px", "1.5x". The stepper never formats. */
  value: string;
  onDecrease: () => void;
  onIncrease: () => void;
  canDecrease?: boolean;
  canIncrease?: boolean;
  decreaseLabel: string;
  increaseLabel: string;
  /** Names the value itself, e.g. "Chat text size". */
  ariaLabel: string;
};

export function Stepper({
  value,
  onDecrease,
  onIncrease,
  canDecrease = true,
  canIncrease = true,
  decreaseLabel,
  increaseLabel,
  ariaLabel,
}: StepperProps) {
  return (
    <div className="vv-stepper inline-flex items-center" role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="vv-stepper__button"
        onClick={onDecrease}
        disabled={!canDecrease}
        aria-label={decreaseLabel}
      >
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="vv-stepper__value" aria-live="polite">{value}</span>
      <button
        type="button"
        className="vv-stepper__button"
        onClick={onIncrease}
        disabled={!canIncrease}
        aria-label={increaseLabel}
      >
        <Plus className="h-4 w-4" strokeWidth={2} />
      </button>
    </div>
  );
}
