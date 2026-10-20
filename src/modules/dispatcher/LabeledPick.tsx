import { useId } from 'react';

import { Select } from '@/shared/ui';
import { cn } from '@/shared/utils';

/** One option of a labelled pick: the word it sends and the words it shows. */
export type PickOption = { value: string; label: string };

type LabeledPickProps = {
  /** The visible name, drawn above the picker: `Runs on`. */
  label: string;
  /** What the name says on hover — the one sentence that tells what the pick does. */
  hint?: string;
  options: PickOption[];
  /** The word of the option that is chosen. A word no option carries draws the select's placeholder. */
  value: string;
  onChoose: (value: string) => void;
  /** A press is out, or the value is not the reader's to change now: the picker shows it and refuses the press. */
  disabled?: boolean;
  /** The picker's width as a Tailwind class — the controller's pickers are short words, a fold's are sentences. */
  width: string;
  /** The harness's handle: one `data-…` attribute carried on the group, valued with the chosen word. */
  handle: string;
};

/**
 * A NAME OVER A PICKER — the one shape every dropdown of the master controller and of a card's fold takes:
 * its visible label, small and muted above it, and the kit's `Select` (a Verve listbox, never a hand-built
 * dropdown) under it. It stands as one unbreakable piece (`flex-none`), so a header too narrow for all its
 * controls wraps BETWEEN pickers and never inside one.
 *
 * ITS LIST IS DRAWN ON `body`, as every kit `Select`'s is: a picker stands in the chat gutter's scrolling widget, in a
 * deck's swipe strip and in a card's fold, every one of which would clip a list drawn beside it; on `body` the list is
 * always whole inside the viewport, above the trigger when the room below is short and held in from the screen's edges.
 * The listbox is therefore NOT inside the group's DOM: a probe finds it by its role.
 *
 * The select's accessible name carries the chosen words after the label (`Runs on: Claude`), because a
 * `Select`'s name replaces what its button shows and the value would otherwise never be announced.
 * The group carries the handle the browser harness reads (`handle`, valued with the chosen word).
 *
 * Used by `MasterController` (the header dropdown) and `ModelPick` (a fold's).
 */
export function LabeledPick({ label, hint, options, value, onChoose, disabled = false, width, handle }: LabeledPickProps) {
  const labelId = useId();
  const chosen = options.find((option) => option.value === value);
  return (
    <div role="group" aria-labelledby={labelId} className="flex min-w-0 flex-none flex-col items-start gap-0.5" {...{ [handle]: value }}>
      <span id={labelId} className="whitespace-nowrap text-xs font-semibold text-muted-foreground" title={hint}>
        {label}
      </span>
      <div className={cn('min-w-0', width)}>
        <Select
          size="sm"
          disabled={disabled}
          options={options}
          value={value}
          onChange={onChoose}
          ariaLabel={chosen ? `${label}: ${chosen.label}` : label}
        />
      </div>
    </div>
  );
}
