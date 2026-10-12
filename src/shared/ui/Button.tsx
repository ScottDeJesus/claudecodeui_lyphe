import * as React from 'react';
import type { VariantProps } from 'class-variance-authority';

import { buttonVariants } from '@/shared/ui/buttonVariants';
import { cn } from '@/shared/utils';

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
