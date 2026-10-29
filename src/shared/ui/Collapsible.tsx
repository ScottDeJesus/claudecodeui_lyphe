import * as React from 'react';

import { CollapsibleContext, useCollapsible } from '@/shared/ui/collapsibleContext';
import { cn } from '@/shared/utils';

type CollapsibleProps = {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
} & React.HTMLAttributes<HTMLDivElement>;

/**
 * The disclosure every fold in the app is built on: the chat's tool output and transcript shapes, the dispatcher's lane
 * cards and their phase rows, the Claude updates panel, the heal lists, Kanban's Metis panel, the follow-ups widget,
 * Cerberus's diagnosis, and the companion's action card. A fold whose hidden body must also leave the tab order wraps it
 * in `CardFoldBody`.
 */
export const Collapsible =React.forwardRef<HTMLDivElement, CollapsibleProps>(
  ({ defaultOpen = false, open: controlledOpen, onOpenChange: controlledOnOpenChange, className, children, ...props }, ref) => {
    const [internalOpen, setInternalOpen] = React.useState(defaultOpen);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : internalOpen;
    const onOpenChange = React.useCallback(
      (next: boolean) => {
        if (!isControlled) setInternalOpen(next);
        controlledOnOpenChange?.(next);
      },
      [isControlled, controlledOnOpenChange]
    );

    const value = React.useMemo(() => ({ open, onOpenChange }), [open, onOpenChange]);

    return (
      <CollapsibleContext.Provider value={value}>
        <div ref={ref} data-state={open ? 'open' : 'closed'} className={className} {...props}>
          {children}
        </div>
      </CollapsibleContext.Provider>
    );
  }
);
Collapsible.displayName = 'Collapsible';

/** Toggle slot of Collapsible, used by the chat module. */
export const CollapsibleTrigger = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ onClick, children, className, ...props }, ref) => {
    const { open, onOpenChange } = useCollapsible();

    const handleClick = React.useCallback(
      (e: React.MouseEvent<HTMLButtonElement>) => {
        onOpenChange(!open);
        onClick?.(e);
      },
      [open, onOpenChange, onClick]
    );

    return (
      <button
        ref={ref}
        type="button"
        aria-expanded={open}
        data-state={open ? 'open' : 'closed'}
        onClick={handleClick}
        className={className}
        {...props}
      >
        {children}
      </button>
    );
  }
);
CollapsibleTrigger.displayName = 'CollapsibleTrigger';

/** Body slot of Collapsible, used by the chat module. */
export const CollapsibleContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const { open } = useCollapsible();

    return (
      <div
        ref={ref}
        data-state={open ? 'open' : 'closed'}
        className={cn(
          'grid transition-[grid-template-rows] duration-200 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
          className
        )}
        {...props}
      >
        <div className="overflow-hidden">
          {children}
        </div>
      </div>
    );
  }
);
CollapsibleContent.displayName = 'CollapsibleContent';

