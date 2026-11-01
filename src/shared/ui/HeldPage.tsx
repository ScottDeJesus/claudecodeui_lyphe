import type { ReactNode } from 'react';

import { OUT_OF_REACH } from '@/shared/constants';
import { HeldPageStateProvider } from '@/shared/context/HeldPageContext';
import { cn } from '@/shared/utils';

/**
 * Draws one of the app's two whole pages, the workspace or Kaylee Station, and HOLDS it while the other is on screen: the page stays
 * mounted with everything it keeps (its state, its scroll, its drafts, its sockets' subscriptions) and nothing of it can be seen,
 * focused, pressed or read out. The wrapper draws no box of its own (`contents`), so the page inside stands exactly where it would
 * stand alone; `invisible` is `visibility: hidden`, which keeps the layout and every scroll position where `display: none` would
 * lose them, and `OUT_OF_REACH` takes the subtree out of the tab order and the reading order.
 *
 * Its CSS animations stand still while it is held (`[data-held-page]` in `src/index.css`): a hidden subtree runs them all the same, at a cost the whole app pays.
 *
 * The wrapper also says, to everything inside, whether its page is held (`useIsPageHeld`, `HeldPageContext`): a `keydown` listener bound to the `document` or the
 * `window` is not stopped by any of the above, so each such listener of a view asks first.
 *
 * Used by the project-workspace module (the frame) and the station module (its layer): two modules, one rule for "the page that is not on screen".
 */
export function HeldPage({ held, children }: { held: boolean; children: ReactNode }) {
  return (
    <HeldPageStateProvider held={held}>
      <div className={cn('contents', held && 'invisible')} data-held-page={held ? '' : undefined} {...(held ? OUT_OF_REACH : {})}>
        {children}
      </div>
    </HeldPageStateProvider>
  );
}
