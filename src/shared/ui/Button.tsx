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
  VariantProps<typeof buttonVariants>;

/** The application-wide button, used by nearly every feature module and by the shared ActionMenu, Confirmation and PromptInput primitives. */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  }
);

Button.displayName = 'Button';

