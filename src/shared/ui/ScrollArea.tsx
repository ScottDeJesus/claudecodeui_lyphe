import * as React from 'react';

import { cn } from '@/shared/utils';

type ScrollAreaProps = React.HTMLAttributes<HTMLDivElement>;

/**
 * A pane's one scroll container, consistently styled. Used by the panes outside the chat transcript
 * that scroll a list of their own: the sidebar, the file tree, the app drawer, the chat gutter's widget
 * frame, the kanban lane and card drawer, and the Heal, Jev, Schedules, DeepSeek-spend, memory-intake
 * and Runner panels.
 *
 * THE INNER SCROLLER IS `relative`, SO IT IS THE CONTAINING BLOCK OF EVERYTHING IT SCROLLS. A static
 * scroller handed every absolutely positioned descendant with no positioned ancestor nearer — an
 * `sr-only` span is one — to the OUTER box. Those nodes escaped the scroll and gave the `overflow-hidden`
 * outer box a scroll range of its own: measured on the Roadmap tab's In flight face at 320px, 2820px of range over a
 * 621px box, from 22 `sr-only` figures in the plan cards. A centring `scrollIntoView`
 * (`block: 'center'`) on a control near the list's end then scrolled that outer box, which no reader
 * can scroll back, and the pane drew its bottom 279px empty with the list's last controls pushed out of
 * reach. (A focus does not reach the range: it scrolls the inner box to its end and stops.)
 */
export const ScrollArea = React.forwardRef<HTMLDivElement, ScrollAreaProps>(
  ({ className, children, ...props }, ref) => (
    <div className={cn(className, 'relative overflow-hidden')} {...props}>
      {/* Inner container keeps border radius while allowing momentum scrolling on touch devices. */}
      <div
        ref={ref}
        className="relative h-full w-full overflow-auto rounded-[inherit]"
        style={{
          WebkitOverflowScrolling: 'touch',
          touchAction: 'pan-y',
        }}
      >
        {children}
      </div>
    </div>
  )
);

ScrollArea.displayName = 'ScrollArea';

