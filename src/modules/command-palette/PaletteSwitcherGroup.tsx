import { CommandGroup, CommandItem } from '@/shared/ui';
import { switcherActValue } from '@/modules/command-palette/utils/switcherActFilter';
import type { SwitcherAction } from '@/shared/types';

type PaletteSwitcherGroupProps = {
  actions: SwitcherAction[];
  /** The palette's own runner: closes the palette, then runs the act. */
  run: (fn: () => void) => void;
};

/**
 * Used by the command palette (CommandPalette) to draw the application switcher's five acts as its
 * "Applications" group. The acts arrive as data from the switcher's `useSwitcherActions`, the list the
 * radial draws too, so a label, the order and which acts are greyed are never written a second time here.
 *
 * A disabled act stays in its place, greyed (cmdk does not select it), as it does in the radial. The row's
 * `value` comes from `switcherActValue`, the text the palette's filter (`createSwitcherFilter`) recognises an
 * act by, so an act is listed only for a query that really names it.
 *
 * Each act runs through the palette's `run`, and `run` is synchronous: the Chat act floats a
 * picture-in-picture window, which the browser allows only inside the keypress or click that asked for it,
 * so nothing here may defer `act.run` behind a promise or a timer.
 */
export function PaletteSwitcherGroup({ actions, run }: PaletteSwitcherGroupProps) {
  return (
    <CommandGroup heading="Applications">
      {actions.map((act) => {
        const Icon = act.icon;
        return (
          <CommandItem
            key={act.key}
            value={switcherActValue(act)}
            disabled={act.disabled}
            onSelect={() => run(act.run)}
          >
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1">{act.label}</span>
            {act.shortcut !== null && (
              <span className="text-xs text-muted-foreground">{act.shortcut}</span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}
