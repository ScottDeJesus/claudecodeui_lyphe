import * as React from 'react';

type CollapsibleContextValue = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** What a `Collapsible` hands its trigger and content: whether it is open and how to change that. Provided by `Collapsible`. */
export const CollapsibleContext = React.createContext<CollapsibleContextValue | null>(null);

/** Used by `Collapsible`'s own trigger and content, by the kit's `CardFold`, and by the claude-updates module's patch notes and job panel, which fold on the same state. */
export function useCollapsible() {
  const ctx = React.useContext(CollapsibleContext);
  if (!ctx) throw new Error('Collapsible components must be used within <Collapsible>');
  return ctx;
}
