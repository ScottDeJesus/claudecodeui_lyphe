import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDownIcon } from 'lucide-react';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/shared/ui';
import { cn } from '@/shared/utils';
import { useShapeCollapse } from '@/modules/chat/transcript/shapes/useShapeCollapse';

type ShapeFrameProps = {
  /** The `data-shape` kind: `table`, `callout`, `verdict`, … — the probes' measuring surface. */
  kind: string;
  title: string;
  /** From `shapeKey(kind, payload)`; the payload each kind uses is fixed by the plan's table. */
  collapseKey: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

/**
 * The one header bar every shape wears.
 *
 * Used by every shape under `shapes/`. It is BUILT ON the shared `Collapsible` primitive rather
 * than on a div and a button: that primitive already exists with its grid-rows animation and
 * already has two consumers, and a hand-rolled disclosure here would be this repo's fourth
 * spelling of open-and-shut — the third of which, `CollapsibleSection`, is where the export rule
 * already lives, which is precisely the evidence that spelling it again gets that rule wrong.
 *
 * It adds exactly three things the primitive does not have: the `data-shape` / `data-collapsed` /
 * `data-shape-toggle` markers a verify script queries to prove a shape painted, the
 * content-addressed fold memory through `useShapeCollapse`, and the `actions` slot's placement.
 * `aria-expanded` comes from `CollapsibleTrigger` itself, off the same state.
 */
export function ShapeFrame({ kind, title, collapseKey, actions, children, className }: ShapeFrameProps) {
  const { t } = useTranslation('chat');
  const { collapsed, toggle, interactive } = useShapeCollapse(collapseKey);

  return (
    <div
      data-shape={kind}
      data-collapsed={String(collapsed)}
      className={cn(
        'not-prose my-3 overflow-hidden rounded-xl border border-border bg-card/50 shadow-sm',
        className
      )}
    >
      <Collapsible open={!collapsed} onOpenChange={toggle}>
        <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
          {interactive ? (
            <CollapsibleTrigger
              data-shape-toggle
              title={collapsed ? t('shapes.expand') : t('shapes.collapse')}
              className="flex min-w-0 flex-1 select-none items-center gap-1.5 text-left transition-colors hover:text-foreground"
            >
              <ChevronDownIcon
                aria-hidden="true"
                className={cn(
                  'h-3.5 w-3.5 flex-shrink-0 transition-transform duration-200',
                  collapsed && '-rotate-90'
                )}
              />
              <span className="truncate font-medium">{title}</span>
            </CollapsibleTrigger>
          ) : (
            // An export has nothing to click, so the toggle is not drawn at all rather than drawn
            // dead. `useShapeCollapse` has already forced `collapsed` false, so the body is whole.
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
          )}
          {actions ? <span className="flex flex-shrink-0 items-center gap-1">{actions}</span> : null}
        </div>
        <CollapsibleContent>
          <div className="border-t border-border/70 px-3 py-2 text-sm text-foreground">{children}</div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
