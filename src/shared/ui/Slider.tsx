import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

type SliderProps = {
  /** The number under the knob, or null while none is known: the track and its ticks are drawn with no knob and no fill, and valueText says so. */
  value: number | null;
  /** The first stop. */
  min: number;
  /** The last stop. */
  max: number;
  /** The distance between two stops; 1 unless said. */
  step?: number;
  /** Every move of the knob, while it is held and from the keyboard: the number to draw. */
  onChange: (next: number) => void;
  /** The knob let go (a pointer's release, a key's step): the number to keep. A slider that saves saves here, never on a move. */
  onCommit?: (next: number) => void;
  /** The accessible name: the visible caption and figure sit in neighbouring cells. */
  label: string;
  /** The number said with its noun ("2 at once"), for a reader that would otherwise hear a bare figure. */
  valueText?: string;
  disabled?: boolean;
};

/** Past this many steps the ticks would crowd into a second rule, so none are drawn. */
const TICKS_MAX = 12;

/**
 * ASTROLABE'S SLIDER: one number out of a short run of stops. A square knob on a hairline track, as the Switch is a square knob in a
 * square track; the track is accent up to the knob and every stop is a tick the knob lands on (.vv-slider, verve/controls.css).
 *
 * IT IS THE BROWSER'S OWN RANGE INPUT with only its knob repainted, so arrows, Home and End move it and a screen reader has its name, its
 * bounds and its value without anything rebuilt here. Under a finger its press is 44 px tall.
 *
 * TWO MOMENTS, TWO PROPS. React's onChange on a range input is the browser's input event and fires on every stop a drag passes. The
 * browser's own change event fires once, when the knob is let go or a key steps it, which is the moment to save; React has no prop for
 * it, so it is listened for on the element and handed to onCommit. A value the page sets itself (a save's answer, a refusal putting the
 * old number back) fires neither.
 *
 * NO NUMBER IS NOT THE FIRST STOP. A null value draws the bare track and its ticks, so an unknown number is never drawn as the lowest
 * one. The input under it still has to hold a value, the first stop, which is why the caller gives valueText its words for unknown.
 */
export function Slider({ value, min, max, step = 1, onChange, onCommit, label, valueText, disabled = false }: SliderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  /** The latest onCommit, read by the one listener below so it is bound once and never calls a stale one. */
  const commitRef = useRef(onCommit);

  useEffect(() => {
    commitRef.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) return undefined;
    const onLetGo = () => commitRef.current?.(Number(input.value));
    input.addEventListener('change', onLetGo);
    return () => input.removeEventListener('change', onLetGo);
  }, []);

  const span = max - min;
  const steps = span > 0 && step > 0 ? Math.round(span / step) : 0;
  // 0 to 1 along the knob's run: where the fill ends, and which ticks it has passed.
  const at = value !== null && span > 0 ? Math.min(1, Math.max(0, (value - min) / span)) : 0;
  const stops = steps > 0 && steps <= TICKS_MAX ? Array.from({ length: steps + 1 }, (_, index) => index / steps) : [];

  return (
    <span className="vv-slider" data-empty={value === null ? '' : undefined} style={{ '--vv-slider-at': String(at) } as CSSProperties}>
      <span className="vv-slider__stops" aria-hidden="true">
        {stops.map((place) => (
          <span
            key={place}
            className="vv-slider__stop"
            data-passed={value !== null && place <= at + 1e-9 ? '' : undefined}
            style={{ '--vv-slider-stop': String(place) } as CSSProperties}
          />
        ))}
      </span>
      <input
        ref={inputRef}
        type="range"
        className="vv-slider__input"
        min={min}
        max={max}
        step={step}
        value={value ?? min}
        aria-label={label}
        aria-valuetext={valueText}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </span>
  );
}
