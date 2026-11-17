import { useContext } from 'react';

import type { useFollowups } from '@/modules/followups';
import { createStableContext } from '@/shared/context/stableContext';
import type { SessionPanelVersionHead } from '@/shared/types';

/**
 * What the chat's panel is, for the three places that draw a part of it: the panel beside the talk, its switch in the chat's
 * head, and the marks in the talk where the chat put a thing there.
 */
export type SessionPanelValue = {
  /** The chat's versions, oldest first; empty while the panel shows nothing or has not been read. */
  versions: readonly SessionPanelVersionHead[];
  /** The version on show: the one the reader walked back to, else the newest. Null while the panel shows nothing. */
  viewing: SessionPanelVersionHead | null;
  /** Whether the reader is on the newest version. */
  onLatest: boolean;
  /** Goes to a version by its id, or to the newest for null; on a narrow screen it brings the panel in front too. */
  lookAt: (id: number | null) => void;
  /** The chat's follow-ups (its next steps and known gaps), the one reading the panel's edge and the switch's count share. */
  followups: ReturnType<typeof useFollowups>;
  /**
   * How the panel stands: `none` while the chat has neither a thing shown nor a follow-up (no panel is drawn), `side` with
   * follow-ups alone (a narrow column of them), `wide` with a thing shown (the panel has the room and the talk the column).
   */
  form: 'none' | 'side' | 'wide';
  /** On a narrow screen one of the two is in front; at a desk both are drawn and this is not read. */
  view: 'talk' | 'panel';
  setView: (view: 'talk' | 'panel') => void;
};

/** Null outside a provider: the floating chat and an exported transcript have no panel, and each part then draws nothing. */
export const SessionPanelContext = createStableContext<SessionPanelValue | null>(import.meta.hot, 'SessionPanelContext', null);

/** The panel of the chat on screen, or null where there is none to speak of (no provider over this part of the page). Read by the module's own parts. */
export function useSessionPanel(): SessionPanelValue | null {
  return useContext(SessionPanelContext);
}
