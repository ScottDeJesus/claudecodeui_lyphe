import { ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { CollapsibleTrigger } from '@/shared/ui';

/**
 * The trigger of the plan face's closed disclosures: its words, and a chevron that turns when it opens.
 * Used by `PlanFace` (the task list and the log) and by `PlanDecided` (the Decided-for-you list).
 */
export function FaceTrigger({ children }: { children: ReactNode }) {
  return (
    <CollapsibleTrigger className="group flex items-center gap-1 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-muted finger:min-h-11">
      <ChevronRight aria-hidden="true" className="size-3.5 flex-none group-data-[state=open]:rotate-90 motion-safe:transition-transform" />
      {children}
    </CollapsibleTrigger>
  );
}
