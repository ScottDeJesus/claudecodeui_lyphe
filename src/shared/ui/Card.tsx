import * as React from 'react';

import { cn } from '@/shared/utils';

type CardProps = React.HTMLAttributes<HTMLDivElement> & {
  /** The whole card is a control. Opts into the hover lift, which promises a click. */
  interactive?: boolean;
};

/**
 * Used by the chat module to frame the provider picker and plan tool output, and by
 * memory-intake to frame each proposed memory in the review queue.
 *
 * Paint is `.vv-card` in verve/controls.css. Padding is deliberately NOT part of it: this
 * card's inset belongs to CardHeader/CardContent/CardFooter, and a padded shell around padded
 * slots insets its content twice. The lift is opt-in and no call site opts in yet: of the two,
 * PlanDisplay's card is not clickable at all, and ProviderSelectionEmptyState's IS
 * (`role="button"`) but spells its own hover today — converting it is a screen edit, so it
 * belongs to Phase 4 rather than here.
 */
export const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, interactive = false, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('vv-card', interactive && 'vv-card--interactive', className)}
      {...props}
    />
  )
);
Card.displayName = 'Card';

/** Header slot of Card, used by the chat module. */
export const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 p-4', className)}
      {...props}
    />
  )
);
CardHeader.displayName = 'CardHeader';

/** Title slot of Card, used by the chat module. */
export const CardTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3
      ref={ref}
      className={cn('font-semibold leading-none tracking-tight', className)}
      {...props}
    />
  )
);
CardTitle.displayName = 'CardTitle';

/** Body slot of Card, used by the chat module. */
export const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-4 pt-0', className)} {...props} />
  )
);
CardContent.displayName = 'CardContent';

/** Footer slot of Card, used by the chat module. */
export const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-4 pt-0', className)} {...props} />
  )
);
CardFooter.displayName = 'CardFooter';
