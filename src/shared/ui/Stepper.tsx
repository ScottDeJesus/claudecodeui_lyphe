import { Minus, Plus } from 'lucide-react';

/**
 * A value with a minus and a plus either side of it — the form for a setting that moves in
 * fixed steps along a scale, where a slider would be too fine and a select would make the
 * reader translate "Medium" into a size.
 *
 * The buttons carry their own accessible names because a glyph has none, and the value between
 * them is announced through `aria-live` so a reader who cannot see it still hears what the
 * press did.
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
  /**
   * A quiet word after the value, inside the control — muted and small, for a value that is not the
   * reader's own choice ("3 · default"). Announced with the value, so a reader who cannot see it still
   * hears which kind of 3 it is.
   */
  note?: string;
  /**
   * The 32px-tall form, for a control that shares a card's action row with `h-8` buttons: the
   * default stepper is 32px of button inside a 1.5px border, and so stands 35px tall in that row.
   */
  compact?: boolean;
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
  note,
  compact = false,
}: StepperProps) {
  return (
    <div className={`vv-stepper${compact ? ' vv-stepper--compact' : ''} inline-flex items-center`} role="group" aria-label={ariaLabel}>
      <button
        type="button"
        className="vv-stepper__button"
        onClick={onDecrease}
        disabled={!canDecrease}
        aria-label={decreaseLabel}
      >
        <Minus className="h-4 w-4" strokeWidth={2} />
      </button>
      <span className="vv-stepper__value" aria-live="polite">
        {value}
        {/* A real space before the note: the dot is drawn and not spoken, so without it a screen
            reader runs the two into one word ("Alldefault"). */}
        {note !== undefined && (
          <>
            {' '}
            <span className="vv-stepper__note">{note}</span>
          </>
        )}
      </span>
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
