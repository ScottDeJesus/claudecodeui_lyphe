import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/shared/utils';

/**
 * Keep visual variants centralized so all button usages stay consistent.
 *
 * A variant now names a paint rule in verve/controls.css instead of carrying colour
 * utilities of its own — one appearance, one place to read it. The focus ring is gone from
 * here too: tokens.css already draws it on every `button:focus-visible`, and the utilities
 * that used to sit here (`focus-visible:outline-none`) were suppressing it.
 *
 * `size` keeps the app's own scale. Verve's padding would resize every button in the app,
 * which is a layout change, not a restyle.
 */
export const buttonVariants = cva(
  'vv-button inline-flex touch-manipulation items-center justify-center gap-2 whitespace-nowrap text-sm font-medium disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'vv-button--default',
        destructive: 'vv-button--destructive',
        outline: 'vv-button--outline',
        secondary: 'vv-button--secondary',
        tonal: 'vv-button--tonal',
        ghost: 'vv-button--ghost',
        link: 'vv-button--link',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 px-3 text-sm',
        lg: 'h-11 px-8',
        icon: 'h-10 w-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    /**
     * A press that is out, or one the button cannot take yet, and the node keeps its focus: it announces
     * `aria-disabled` (and `aria-busy`) and takes the dimmed look of `.vv-button[aria-disabled='true']`, where a real
     * `disabled` blurs the button the moment it is set — so the person who pressed it with Enter finds focus on the
     * page, and after a refusal still has to Tab from the top. The button refuses the press itself: its click goes to
     * no handler and submits no form. Same contract as `Chip`'s `busy`. `disabled` stays for a control that is
     * unavailable for good or for a reason no press caused.
     */
    busy?: boolean;
  };

/** What a refusing button does with a press: nothing, and no form submits. */
function refusePress(event: React.MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

/** The application-wide button, used by nearly every feature module and by the shared ActionMenu, Confirmation and PromptInput primitives. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, busy = false, onClick, ...props }, ref) => {
    // `busy`, or an `aria-disabled` a caller spells itself: either way the press is refused here, not in each handler.
    const refusing = busy || props['aria-disabled'] === true || props['aria-disabled'] === 'true';
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
        aria-disabled={refusing || undefined}
        aria-busy={busy || props['aria-busy'] || undefined}
        onClick={refusing ? refusePress : onClick}
      />
    );
  }
);

Button.displayName = 'Button';
