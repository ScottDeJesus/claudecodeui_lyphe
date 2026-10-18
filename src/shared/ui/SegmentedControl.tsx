import type { KeyboardEvent } from 'react';

type SegmentedControlProps<T extends string> = {
  /** The choices, in the order drawn. `count` is an optional number beside the word (a queue's length). */
  options: { value: T; label: string; count?: number }[];
  /** The chosen option's `value`. A value no option carries leaves nothing chosen, and the first option holds the Tab stop. */
  value: T;
  onChange: (value: T) => void;
  /** The group's accessible name — "Queue mode", "Layer". A radio group needs one. */
  label: string;
};

/**
 * Used by the affected-areas module: the Tours · Mark · Tables sub-switch, the pano's layer switch and the
 * Mark screen's queue mode — Verve's §11 Plumbing "IconButton · SegmentedControl".
 *
 * A switch between a few views of the same thing, drawn as one tray with the chosen option lifted on its own
 * surface. It is a RADIO GROUP, not a tablist: it chooses a value and owns no panel (`Tabs` is the strip that
 * does). The arrow keys move the choice, so the selection follows focus the way a native radio group's does;
 * Home and End go to the ends. Exactly one option holds the Tab stop (roving tabindex) — the chosen one, else the
 * first — so a tray of five is one stop in the page's order, not five.
 *
 * The pill does not slide: the chosen option paints its own ground, the departure `Tabs` already records
 * (feedback.css), because a slid indicator has to be measured and reads a stale box for a frame after a relabel.
 */
export function SegmentedControl<T extends string>({ options, value, onChange, label }: SegmentedControlProps<T>) {
  const chosenIndex = options.findIndex((option) => option.value === value);
  const stopIndex = chosenIndex === -1 ? 0 : chosenIndex;

  /**
   * Arrow / Home / End choose the neighbour and move focus to it; any other key is the page's own. So is an arrow held
   * with Alt, Ctrl or Meta (the browser's history, a word jump, a platform shortcut), and every key of a group with
   * nothing to move to: one option is already the choice, and calling `onChange` with it would be a change that is none.
   */
  function chooseByKey(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (options.length < 2 || event.altKey || event.ctrlKey || event.metaKey) return;
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % options.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + options.length) % options.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = options.length - 1;
    else return;

    event.preventDefault();
    // Focus first: the option about to be chosen is the one that takes the Tab stop on the re-render.
    const radios = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    radios?.[next]?.focus();
    onChange(options[next].value);
  }

  return (
    <div role="radiogroup" aria-label={label} className="vv-segmented inline-flex max-w-full items-center">
      {options.map((option, index) => {
        const chosen = index === chosenIndex;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={chosen}
            tabIndex={index === stopIndex ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => chooseByKey(event, index)}
            className="vv-segmented__option"
          >
            {/* The word gives way first when the tray is squeezed (an ellipsis); the count never does. */}
            <span className="vv-segmented__label">{option.label}</span>
            {/* Read with the word ("Mark 12"): the number is part of what the option is called. */}
            {option.count !== undefined && (
              <span className="vv-segmented__count" data-tone="neutral">
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
