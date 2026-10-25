import { createContext, useContext } from 'react';

import type { useFollowups } from '@/modules/followups/hooks/useFollowups';

/**
 * What the Next steps widget's body reads: the one reading `ChatGutterLayout` makes of the open chat's followups
 * (`useFollowups`), handed down so the badge outside the widget's boundary and the rows inside it are the same
 * list. `null` on purpose, not a filled-in default: a body mounted outside the layout would otherwise draw a list
 * nobody reads for.
 */
export type FollowupsValue = ReturnType<typeof useFollowups>;

/** Provided by `ChatGutterLayout` around the gutters; read by `FollowupsWidgetBody` through `useFollowupsContext`. */
export const FollowupsContext = createContext<FollowupsValue | null>(null);

/** The reading the layout provides, or a loud error when the body is mounted without it. */
export function useFollowupsContext(): FollowupsValue {
  const value = useContext(FollowupsContext);
  if (value === null) throw new Error('useFollowupsContext must be used inside the chat gutter layout.');
  return value;
}
