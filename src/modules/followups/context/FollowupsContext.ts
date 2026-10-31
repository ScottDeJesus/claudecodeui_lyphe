import { createContext, useContext } from 'react';

import type { useFollowups } from '@/modules/followups/hooks/useFollowups';

/**
 * What the Next steps widget's body reads: the one reading its host makes of a chat's followups (`useFollowups`) —
 * `ChatGutterLayout`'s of the open chat, so the badge outside the widget's boundary and the rows inside it are the same
 * list, or the station's follow-ups stage's of the chat on its stage. `null` on purpose, not a filled-in default: a body
 * mounted outside a host would otherwise draw a list nobody reads for.
 */
export type FollowupsValue = ReturnType<typeof useFollowups>;

/**
 * Provided by `ChatGutterLayout` around the gutters and by the station's `FollowupsStage` around its body; read by
 * `FollowupsWidgetBody` through `useFollowupsContext`.
 */
export const FollowupsContext = createContext<FollowupsValue | null>(null);

/** The reading the host provides, or a loud error when the body is mounted without one. */
export function useFollowupsContext(): FollowupsValue {
  const value = useContext(FollowupsContext);
  if (value === null) throw new Error('useFollowupsContext must be used inside a FollowupsContext provider (the chat gutter layout, the station\'s follow-ups stage).');
  return value;
}
