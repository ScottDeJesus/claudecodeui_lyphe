type StepsProps = {
  /** The step names, already translated, in order. */
  steps: string[];
  /** The step in hand, from 0. Every step before it is done; one past the last marks them all done. */
  current: number;
};

/**
 * Verve's navigation `Stepper` (`_ds_bundle.js`, components/navigation/Stepper.jsx): numbered rounds
 * joined by a rail, a ✓ in place of the number once a step is done, the rail filling with the accent
 * behind the step in hand. Used by the cerberus module's Enroll dialog (Name it · Install · Say hello).
 *
 * Named `Steps` because `Stepper` here is the numeric minus/plus control. It only shows where a flow
 * stands — a step is not pressable — so there is no `onSelect`, which is also why a done step's ✓ and
 * the current step's `aria-current` carry the state in words and marks as well as colour.
 *
 * Paint is `.vv-steps*` in verve/panels.css.
 */
export function Steps({ steps, current }: StepsProps) {
  return (
    <ol className="vv-steps m-0 flex list-none items-center p-0">
      {steps.map((label, index) => {
        const state = index < current ? 'done' : index === current ? 'current' : 'todo';
        return (
          <li
            key={index}
            className="vv-steps__step flex items-center"
            data-state={state}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className="flex flex-col items-center gap-1.5">
              <span className="vv-steps__round flex items-center justify-center">{state === 'done' ? '✓' : index + 1}</span>
              <span className="vv-steps__label">{label}</span>
            </span>
            {index < steps.length - 1 ? <span className="vv-steps__rail" data-filled={index < current || undefined} aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}
