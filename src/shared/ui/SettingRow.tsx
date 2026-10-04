import { Children, type HTMLAttributes, type ReactNode } from 'react';

import { cn } from '@/shared/utils';

type SettingRowProps = HTMLAttributes<HTMLDivElement> & {
  /** The title. A string, or nodes when the title carries marks that must wrap with its words — a version, a scope, a status badge. */
  label: ReactNode;
  /** A small mark drawn before the label, for a row that belongs to a named vendor or a named shape. */
  icon?: ReactNode;
  /** The helper text under the label: a string, or nodes for a sentence with links and a byline in it. */
  description?: ReactNode;
  /** The control — a switch, a stepper, a field, a row of buttons. It is never asked to fit beside the text. `null` draws a row with no control and no slot for one. */
  children: ReactNode;
};

/**
 * One labelled setting and its control: the row every Settings tab, the language picker, the heal
 * panel's settings dialog, the plugin cards and the MCP server rows lay out. Used by the settings,
 * i18n, heal, plugins and mcp modules — every one past the first is what admits it here.
 *
 * THE LAYOUT FOLLOWS THE ROW'S OWN WIDTH, NOT THE VIEWPORT. The row wraps, and the text column
 * holds a floor of 10rem (or the whole row, when the row is narrower than that): the controls sit
 * beside the text while a 10rem column still fits next to them, and drop below it when it does not.
 * 10rem is where a 52px switch stays inline from a 320px phone through 390px at a 1.07× text scale,
 * the scale the operator's phone runs at: 11rem already drops it at 320, 12rem at 341 and 13rem at
 * 360. It leaves a column of about 25 characters at 12px beside a switch.
 * So a switch keeps the native phone look, inline at the right of its label; a stepper, a row of
 * buttons or a fixed-width field goes under its text; and the Settings modal and the heal dialog,
 * which are different widths at the same viewport, are each right at any size — a `sm:` breakpoint
 * reads the window and gets one of them wrong.
 *
 * The floor is what keeps the words readable. The controls are `shrink-0` and take what they
 * need, so without it the text column would get only the remainder — a 1px sliver on a 360px phone
 * beside a stepper, a ghost button and a switch — and the label, whose longest word sets its own
 * minimum width, would spill out of that column and under the controls.
 *
 * The icon has its own slot that never shrinks and the label its own that may, so a wrapping label
 * cannot squeeze a bare icon to nothing and no caller patches its glyph.
 *
 * The label and the description take nodes, so a card that names a thing and marks it (a plugin's
 * version and slot, an MCP server's transport and scope) puts the marks in the label, where they
 * wrap with the words and never compete with the controls for the floor. A status badge on a row
 * that has no control belongs there too, with `null` as the children: in the controls slot the
 * floor would treat a badge like a button and drop it below the text on a 320px phone.
 *
 * Any other attribute (a `data-*` hook, say) lands on the root.
 */
export function SettingRow({ label, icon, description, children, className, ...rest }: SettingRowProps) {
  // A row with nothing to control draws no slot: an empty `shrink-0` wrapper still takes a flex
  // line of its own once the text column fills the row, and adds a blank band under the text.
  const hasControl = Children.toArray(children).length > 0;
  return (
    <div
      {...rest}
      className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-4 py-4', className)}
    >
      <div className="min-w-[min(100%,10rem)] flex-1">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          {icon && <span className="flex shrink-0">{icon}</span>}
          <div className="min-w-0 break-words">{label}</div>
        </div>
        {description && (
          <div className="mt-1 break-words text-xs leading-relaxed text-muted-foreground">{description}</div>
        )}
      </div>
      {/* Top-aligned, not centred: a two-line helper would otherwise drag the control down with it. */}
      {hasControl && <div className="max-w-full shrink-0 pt-0.5">{children}</div>}
    </div>
  );
}
